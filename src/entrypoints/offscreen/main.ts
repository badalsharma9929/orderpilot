// Offscreen document: layer A fetch + DOMParser (service workers have no DOM),
// and ZIP building (needs URL.createObjectURL for chrome.downloads).

import type { OffscreenRequest } from '@/core/messaging';
import { fetchParse } from '@/core/fetchParse';
import { applyOverrides } from '@/core/overrides';
import { db } from '@/db/dexie';
import { buildZip, invoiceFileName } from '@/core/zip';
import { buildReport } from '@/core/report';
import { XLSX_MIME } from '@/core/xlsx';

chrome.runtime.onMessage.addListener((msg: OffscreenRequest, _s, sendResponse) => {
  if (msg?.kind !== 'offscreen') return;
  handle(msg).then(sendResponse, (e) => sendResponse({ ok: false, reason: 'network', message: String(e?.message ?? e) }));
  return true;
});

async function handle(msg: OffscreenRequest) {
  switch (msg.op) {
    case 'fetchParse':
      applyOverrides(msg.overrides); // offscreen pages can't read storage; the worker sends the current overrides
      return fetchParse(msg.url, msg.parser, msg.args);
    case 'buildZip': {
      const rows = await db.invoices.bulkGet(msg.invoiceKeys);
      const blobs = await db.invoiceBlobs.bulkGet(msg.invoiceKeys);
      const entries = rows.flatMap((r, i) => (r && blobs[i] ? [{ name: invoiceFileName(r.platform, r.orderId, r.invoiceNo), data: blobs[i]!.blob }] : []));
      if (!entries.length) return { ok: false, message: 'no invoice files' };
      const zip = await buildZip(entries);
      return { ok: true, url: URL.createObjectURL(zip), count: entries.length, size: zip.size };
    }
    case 'buildReport': {
      const { bytes, orders } = await buildReport(db);
      const blob = new Blob([new Uint8Array(bytes)], { type: XLSX_MIME });
      return { ok: true, url: URL.createObjectURL(blob), orders };
    }
    case 'revoke':
      URL.revokeObjectURL(msg.url);
      return { ok: true };
  }
}
