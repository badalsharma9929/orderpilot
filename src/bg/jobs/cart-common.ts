// Shared machinery for the per-site Cart Builder flows: one ladder runner, tab
// messaging, verification and hand-off helpers. Site flows hold only site logic.

import { runLadder, BlockedError, type Strategy } from '@/core/ladder';
import type { CsActionResult, FetchParseResult } from '@/core/messaging';
import type { Platform } from '@/core/schemas';
import { DexieLadderStats, type CartRunRow } from '@/db/dexie';
import { claudePickElement } from '@/llm/claude';
import { emit } from '../progress';
import { navigate, sendToTab } from '../tabs';

export type Step = CartRunRow['steps'][number];
export type Log = (step: string, ok: boolean, extra?: Partial<Step>) => void;

const stats = new DexieLadderStats();
let site: Platform = 'amazon';
let cancelled = false;
export let lastLayer: string | undefined;

export const startCart = (p: Platform) => { site = p; cancelled = false; lastLayer = undefined; };
export const cancelCart = () => { cancelled = true; };
export const checkCancel = () => { if (cancelled) throw new Error('cancelled by you'); };

export class AlreadyDone extends Error {}

export async function ladder<T>(op: string, strategies: Strategy<T>[], validate?: (v: T) => string[]): Promise<T> {
  const r = await runLadder({
    site, op: `cart.${op}`, strategies, validate, stats,
    onAttempt: (a) => a.error && emit('cart', `${op}: layer ${a.layer} (${a.name}) failed`, { ok: false, layer: a.layer, note: a.error }),
  });
  if (r.ok) { lastLayer = r.layer; return r.value; }
  if (r.blocked) throw new BlockedError(r.blocked, `${op} blocked: ${r.blocked}`);
  throw new Error(`${op} failed on every layer`);
}

export function unwrapRead<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok) throw new Error('read failed');
  return r.value as T;
}

export async function liveParse<T>(tabId: number, parser: string, args?: unknown): Promise<T> {
  const r = await sendToTab<FetchParseResult>(tabId, { kind: 'cs', op: 'parseLive', parser: parser as any, args });
  if (r.ok) return r.data as T;
  if (r.reason === 'captcha') { await banner(tabId, 'Please solve the check on this page, then run again.'); throw new BlockedError('captcha'); }
  if (r.reason === 'signed-out') throw new BlockedError('login', `Sign in to ${site} in this tab, then run again`);
  throw new Error(`${r.reason}${'message' in r ? `: ${r.message}` : ''}`);
}

/** Same-origin JSON API call made from inside the site tab (layer B for API reads). */
export async function tabFetch<T>(tabId: number, url: string, parser: string, args?: unknown): Promise<T> {
  const r = await sendToTab<FetchParseResult>(tabId, { kind: 'cs', op: 'fetchParse', url, parser: parser as any, args });
  if (r.ok) return r.data as T;
  if (r.reason === 'signed-out') throw new Error('API says signed out');
  throw new Error(`${r.reason}${'message' in r ? `: ${r.message}` : ''}`);
}

export async function action(tabId: number, name: string, args?: unknown): Promise<CsActionResult> {
  return sendToTab<CsActionResult>(tabId, { kind: 'cs', op: 'action', action: name, args });
}

export async function mustAct(tabId: number, name: string, args?: unknown) {
  const r = await action(tabId, name, args);
  if (!r.ok) {
    if (r.blocked) throw new BlockedError(r.blocked as any, r.error);
    throw new Error(r.error);
  }
  return r;
}

export async function verify(probe: () => Promise<unknown>, waitMs = 6000): Promise<true> {
  const end = Date.now() + waitMs;
  for (;;) {
    if (await probe()) return true;
    if (Date.now() > end) throw new Error('action had no effect on the cart');
    await new Promise((r) => setTimeout(r, waitMs > 10000 ? 2000 : 700));
  }
}

export async function ensureUrl(tabId: number, url: string, same: (current: string) => boolean = (c) => c.split('?')[0] === url.split('?')[0]) {
  const t = await chrome.tabs.get(tabId);
  if (!same(t.url ?? '')) await navigate(tabId, url);
}

export async function banner(tabId: number, text: string) {
  await sendToTab(tabId, { kind: 'cs', op: 'highlight', text }, 5000).catch(() => {});
}

export async function tabText(tabId: number): Promise<string> {
  return (await sendToTab<{ text: string }>(tabId, { kind: 'cs', op: 'pageText' })).text;
}

export async function claudeClick(tabId: number, goal: string) {
  const inv = await sendToTab<{ ok: boolean; data: any[] }>(tabId, { kind: 'cs', op: 'action', action: 'inventory' });
  const index = await claudePickElement(goal, inv.data);
  // Send the label too: the page may have changed since the inventory was taken.
  await mustAct(tabId, 'clickIndex', { index, text: inv.data.find((e: any) => e.index === index)?.text });
}

/** Opens the product URL in the active tab (reusing it when it already shows that product). */
export async function productTab(url: string, sameProduct: (a: string | undefined) => boolean): Promise<number> {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  let tabId = active?.id;
  if (tabId == null || !active.url?.startsWith('http')) tabId = (await chrome.tabs.create({ url: 'about:blank', active: true })).id!;
  if (!sameProduct(active?.url)) await navigate(tabId, url);
  return tabId;
}
