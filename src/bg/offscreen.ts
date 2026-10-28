import type { OffscreenRequest } from '@/core/messaging';

let creating: Promise<void> | null = null;

export async function ensureOffscreen() {
  const url = chrome.runtime.getURL('/offscreen.html');
  const existing = await chrome.runtime.getContexts?.({ contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType], documentUrls: [url] });
  if (existing?.length) return;
  creating ??= chrome.offscreen
    .createDocument({ url, reasons: ['DOM_PARSER' as chrome.offscreen.Reason, 'BLOBS' as chrome.offscreen.Reason], justification: 'Parse fetched order pages and build invoice ZIPs' })
    .catch((e) => { if (!String(e).includes('Only a single offscreen')) throw e; })
    .finally(() => { creating = null; });
  await creating;
}

export async function toOffscreen<T = any>(msg: OffscreenRequest): Promise<T> {
  await ensureOffscreen();
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}
