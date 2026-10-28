import type { CsRequest } from '@/core/messaging';
import type { Platform } from '@/core/schemas';

const HOST: Record<Platform, string> = {
  amazon: '*://*.amazon.in/*',
  flipkart: '*://*.flipkart.com/*',
  jiomart: '*://*.jiomart.com/*',
};

/** Any open tab on the site (used by layer B: same-origin fetch through its content script). */
export async function findSiteTab(platform: Platform): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ url: HOST[platform], status: 'complete' });
  return tabs.find((t) => !t.discarded && t.id != null);
}

export function waitForComplete(tabId: number, timeoutMs = 20000, urlTest?: (u: string) => boolean): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    const done = (tab: chrome.tabs.Tab) => { cleanup(); resolve(tab); };
    const t = setTimeout(() => { cleanup(); reject(new Error('page load timed out')); }, timeoutMs);
    const listener: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (id, info, tab) => {
      if (id === tabId && info.status === 'complete' && (!urlTest || urlTest(tab.url ?? ''))) done(tab);
    };
    const cleanup = () => { clearTimeout(t); chrome.tabs.onUpdated.removeListener(listener); };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => { if (tab.status === 'complete' && (!urlTest || urlTest(tab.url ?? ''))) done(tab); }).catch(() => {});
  });
}

/**
 * Navigates and returns as soon as the new page is usable: either Chrome says
 * "complete", or OrderPilot's script already answers on the new page (heavy
 * shop pages can keep loading ads/trackers long after they are usable).
 */
export async function navigate(tabId: number, url: string, timeoutMs = 20000) {
  await chrome.tabs.update(tabId, { url });
  // Wait for the *new* page, not the old one that is still "complete".
  await new Promise((r) => setTimeout(r, 150));
  const target = new URL(url);
  const onNewPage = (t: chrome.tabs.Tab) => !t.pendingUrl && !!t.url && t.url.startsWith(target.origin + target.pathname.replace(/\/$/, ''));
  const scriptReady = (async () => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      await new Promise((r) => setTimeout(r, 250));
      const t = await chrome.tabs.get(tabId).catch(() => null);
      if (!t) throw new Error('tab closed');
      if (!onNewPage(t) || t.status !== 'complete' && !(await chrome.tabs.sendMessage(tabId, { kind: 'cs', op: 'ping' }).catch(() => null))) continue;
      return t;
    }
    throw new Error('page load timed out');
  })();
  return Promise.any([waitForComplete(tabId, timeoutMs), scriptReady]).catch(() => { throw new Error('page load timed out'); });
}

const CONTENT_SCRIPT: Partial<Record<Platform, string>> = {
  amazon: 'content-scripts/amazon.js',
  jiomart: 'content-scripts/jiomart.js',
};

function platformOfTabUrl(url: string): Platform | null {
  try {
    const h = new URL(url).hostname;
    if (/(^|\.)amazon\.in$/.test(h)) return 'amazon';
    if (/(^|\.)jiomart\.com$/.test(h)) return 'jiomart';
  } catch {}
  return null;
}

/**
 * Chrome only adds content scripts to pages loaded after the extension was
 * installed or reloaded. A tab opened earlier has no script (or a dead one),
 * so add it now. Returns true if a script was injected.
 */
export async function injectContentScript(tabId: number): Promise<boolean> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url || tab.status !== 'complete') return false;
  const file = CONTENT_SCRIPT[platformOfTabUrl(tab.url) as Platform];
  if (!file) return false;
  await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
  return true;
}

const NO_RECEIVER = /Receiving end does not exist|Could not establish connection|message port closed/i;

/** Sends to the tab's content script, retrying while it boots and injecting it if the tab predates the extension. */
export async function sendToTab<T = any>(tabId: number, msg: CsRequest, timeoutMs = 15000): Promise<T> {
  const end = Date.now() + timeoutMs;
  const started = Date.now();
  let lastErr: unknown;
  let injected = false;
  while (Date.now() < end) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, msg);
      if (res !== undefined) return res as T;
    } catch (e) {
      lastErr = e;
      // Give a freshly loading page a moment to start its own script before injecting one.
      if (!injected && NO_RECEIVER.test(String((e as Error)?.message ?? e)) && Date.now() - started > 700) {
        injected = await injectContentScript(tabId).catch(() => false);
        if (injected) continue;
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`content script did not answer: ${lastErr instanceof Error ? lastErr.message : 'timeout'}`);
}

/** Light same-origin page for a site: same-origin requests from it carry the login cookie. */
export const sitePageUrl = (origin: string) => `${origin}/robots.txt`;

/**
 * Makes a worker tab show a page of the site and waits until OrderPilot's
 * script answers there. Readiness = the script responds, not Chrome's "complete"
 * signal, which heavy pages can delay for a long time.
 */
export async function ensureSitePage(tabId: number, origin: string) {
  const t = await chrome.tabs.get(tabId).catch(() => null);
  let current = '';
  try { current = new URL(t?.pendingUrl || t?.url || '').origin; } catch {}
  if (current !== origin) await chrome.tabs.update(tabId, { url: sitePageUrl(origin) });
  await sendToTab(tabId, { kind: 'cs', op: 'ping' }, 20000);
}

// Worker tabs (layers B/C/D when no site tab is open): up to 3 reusable,
// inactive tabs. They open in the background of an existing Chrome window,
// because pages in a minimized window may never finish loading; a minimized
// window is only created when no normal window exists. Slots are counted
// separately from tabs, so a failed create or a tab you closed never leaks a slot.
const MAX_WORKER_TABS = 3;
let generation = 0;
let ownWindowId: number | null = null;
let ownWindowPromise: Promise<number> | null = null;
let workerTabs = new Set<number>();
let idleTabs: number[] = [];
let slotsInUse = 0;
const waiters: Array<() => void> = [];

function resetWorkers() {
  generation++;
  idleTabs = [];
  workerTabs = new Set();
  ownWindowPromise = null;
  ownWindowId = null;
}

async function hostWindow(): Promise<number | undefined> {
  const wins = await chrome.windows.getAll({ windowTypes: ['normal'] });
  const usable = wins.filter((w) => w.id != null && w.id !== ownWindowId && w.state !== 'minimized');
  if (usable.length) return (usable.find((w) => w.focused) ?? usable[0]).id;
  if (ownWindowId != null && (await chrome.windows.get(ownWindowId).then(() => true, () => false))) return ownWindowId;
  ownWindowPromise ??= chrome.windows.create({ url: 'about:blank', focused: false, state: 'minimized' })
    .then((w) => { ownWindowId = w!.id!; const first = w!.tabs?.[0]?.id; if (first != null) { workerTabs.add(first); idleTabs.push(first); } return ownWindowId; })
    .finally(() => { ownWindowPromise = null; });
  return ownWindowPromise;
}

async function acquireSlot() {
  if (slotsInUse < MAX_WORKER_TABS) { slotsInUse++; return; }
  await new Promise<void>((r) => waiters.push(r)); // a released slot is handed over directly
}

function releaseSlot() {
  const next = waiters.shift();
  if (next) next();
  else slotsInUse--;
}

const alive = (tabId: number) => chrome.tabs.get(tabId).then(() => true, () => false);

export async function withWorkerTab<T>(fn: (tabId: number) => Promise<T>, startUrl = 'about:blank'): Promise<T> {
  await acquireSlot();
  try {
    const gen = generation;
    let tabId: number | undefined;
    while (idleTabs.length && tabId == null) { const t = idleTabs.pop()!; if (await alive(t)) tabId = t; }
    if (tabId == null) {
      const windowId = await hostWindow();
      tabId = (await chrome.tabs.create({ windowId, url: startUrl, active: false })).id!;
      workerTabs.add(tabId);
    }
    try {
      return await fn(tabId);
    } finally {
      if (gen === generation && (await alive(tabId))) idleTabs.push(tabId);
    }
  } finally {
    releaseSlot();
  }
}

/** Closes every worker tab (and the helper window, if one had to be created) after a job. */
export async function closeWorkerWindow() {
  const tabs = [...workerTabs];
  const win = ownWindowId;
  resetWorkers();
  if (tabs.length) await chrome.tabs.remove(tabs).catch(async () => { for (const t of tabs) await chrome.tabs.remove(t).catch(() => {}); });
  if (win != null) await chrome.windows.remove(win).catch(() => {});
}
