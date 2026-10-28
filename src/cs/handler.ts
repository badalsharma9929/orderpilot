// Generic content-script message handler, shared by every site.

import type { CsRequest, CsActionResult } from '@/core/messaging';
import { fetchParse, parseDocument } from '@/core/fetchParse';
import { pageText } from '@/adapters/common';
import { maskPII } from '@/llm/mask';
import { BlockedError } from '@/core/ladder';
import { clickableInventory, safeClick } from '@/core/actions';
import { watchOverrides } from '@/core/overrides';

type Actions = Record<string, (args: any) => Promise<CsActionResult>>;

/**
 * Installs the message handler once per page. A copy left over from before an
 * extension reload is dead (its chrome.runtime is gone), so a fresh copy may
 * replace it; a live copy is never duplicated. Returns false if one was already running.
 */
export function installHandler(actions: Actions): boolean {
  const g = globalThis as any;
  if (g.__orderpilotAlive?.()) return false;
  g.__orderpilotAlive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  watchOverrides().catch(() => {});
  chrome.runtime.onMessage.addListener((msg: CsRequest, _sender, sendResponse) => {
    if (msg?.kind !== 'cs') return;
    handle(msg, actions).then(sendResponse, (e) =>
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e), blocked: e instanceof BlockedError ? e.reason : undefined }),
    );
    return true; // async response
  });
  return true;
}

async function handle(msg: CsRequest, actions: Actions): Promise<unknown> {
  switch (msg.op) {
    case 'ping':
      return { ok: true, url: location.href };
    case 'parseLive':
      return parseDocument(document, location.href, msg.parser, msg.args);
    case 'fetchParse':
      return fetchParse(msg.url, msg.parser, msg.args);
    case 'fetchBytes': {
      const res = await fetch(msg.url, { credentials: 'include' });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const buf = new Uint8Array(await res.arrayBuffer());
      return { ok: true, type: res.headers.get('content-type') ?? '', b64: toBase64(buf) };
    }
    case 'action': {
      if (msg.action === 'clickIndex') {
        // Layer D: Claude picked an element from the inventory; the payment guard still applies.
        const inv = clickableInventory();
        const hit = inv[msg.args.index];
        if (!hit) return { ok: false, error: 'index out of range' };
        if (msg.args.text != null && hit.text !== msg.args.text) return { ok: false, error: 'page changed since the element list was taken' };
        safeClick(hit.el);
        return { ok: true, layer: 'D' };
      }
      if (msg.action === 'inventory') {
        return { ok: true, data: clickableInventory().map(({ el: _el, ...rest }) => rest) };
      }
      const fn = actions[msg.action];
      if (!fn) return { ok: false, error: `unknown action ${msg.action}` };
      return fn(msg.args ?? {});
    }
    case 'pageText':
      return { ok: true, text: maskPII(pageText(document)), url: location.href };
    case 'pageHtml':
      return { ok: true, html: document.documentElement.outerHTML, url: location.href };
    case 'highlight':
      showBanner(msg.text);
      return { ok: true };
  }
}

function toBase64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Layer E: tell the user what to do on this page. */
function showBanner(text: string) {
  document.getElementById('orderpilot-banner')?.remove();
  const el = document.createElement('div');
  el.id = 'orderpilot-banner';
  el.textContent = `OrderPilot: ${text}`;
  Object.assign(el.style, {
    position: 'fixed', top: '12px', left: '50%', transform: 'translateX(-50%)', zIndex: '2147483647',
    background: '#2a78d6', color: '#fff', padding: '10px 16px', borderRadius: '10px', font: '600 14px system-ui',
    boxShadow: '0 8px 30px rgba(0,0,0,.25)', maxWidth: '90vw',
  });
  el.onclick = () => el.remove();
  document.documentElement.appendChild(el);
}
