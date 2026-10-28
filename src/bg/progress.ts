import type { ProgressEvent } from '@/core/messaging';

const recent: ProgressEvent[] = [];

export function emit(job: ProgressEvent['job'], step: string, extra: Partial<ProgressEvent> = {}) {
  const ev: ProgressEvent = { kind: 'progress', job, at: new Date().toISOString(), step, ...extra };
  recent.push(ev);
  if (recent.length > 300) recent.splice(0, recent.length - 300);
  chrome.storage.session?.set({ progress: recent.slice(-120) }).catch(() => {});
  chrome.runtime.sendMessage(ev).catch(() => {}); // side panel may be closed
  return ev;
}

export async function notify(title: string, message: string) {
  const { settings } = (await chrome.storage.local.get('settings')) as { settings?: { notify?: boolean } };
  if (settings?.notify === false) return;
  chrome.notifications.create({ type: 'basic', iconUrl: chrome.runtime.getURL('/icon/128.png'), title, message, priority: 1 });
}

/** One job of each kind at a time. */
const running = new Map<string, Promise<unknown>>();
export function exclusive<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const cur = running.get(name);
  if (cur) return cur as Promise<T>;
  // Chrome stops an idle MV3 worker after ~30 s; an extension API call every
  // 20 s keeps it alive while a job (and any wait for the user) is running.
  const keepAlive = setInterval(() => { chrome.runtime.getPlatformInfo().catch(() => {}); }, 20_000);
  const p = fn().finally(() => { clearInterval(keepAlive); running.delete(name); });
  running.set(name, p);
  return p;
}
