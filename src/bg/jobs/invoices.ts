// Invoice collection: discover invoice PDFs per order, download each one
// exactly once (key + SHA-256), and zip the day's new ones per account.

import { AMAZON } from '@/adapters/amazon/selectors';
import { JIOMART } from '@/adapters/jiomart/selectors';
import type { JioOrderPage } from '@/adapters/jiomart/parsers';
import { invoiceKey, sha256Hex } from '@/core/dedupe';
import type { InvoiceRef, Platform } from '@/core/schemas';
import { zipDownloadPath } from '@/core/zip';
import { db, type InvoiceRow, type OrderRow } from '@/db/dexie';
import { localDay } from '@/db/repo';
import { cleanFolder, getSettings } from '@/core/settings';
import { emit, notify } from '../progress';
import { read, poolFor } from '../read';
import { toOffscreen } from '../offscreen';
import { closeWorkerWindow, ensureSitePage, findSiteTab, sendToTab, sitePageUrl, withWorkerTab } from '../tabs';
import { originFor } from './sweep';
import { logError } from '../errors';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF

interface Ctx { today: string; known: Set<string>; knownHashes: Set<string>; fetched: number }

export async function runInvoices(): Promise<{ fetched: number; zips: number }> {
  emit('invoices', 'Checking invoices');
  const ctx: Ctx = {
    today: localDay(),
    known: new Set((await db.invoices.toCollection().primaryKeys()) as string[]),
    knownHashes: new Set((await db.invoices.toArray()).map((r) => r.sha256).filter(Boolean) as string[]),
    fetched: 0,
  };
  const cfg = await getSettings();
  const recentCutoff = cfg.invoiceLookbackDays > 0 ? new Date(Date.now() - cfg.invoiceLookbackDays * 864e5).toISOString().slice(0, 10) : '0000-00-00';
  const sites = cfg.sites;
  for (const platform of sites) {
    if (platform !== 'amazon' && platform !== 'jiomart') continue;
    const origin = await originFor(platform);
    const candidates = (await db.orders.where('platform').equals(platform).toArray()).filter((o) =>
      (o.orderDate ?? ctx.today) >= recentCutoff && !/cancel/i.test(o.status) && !o.invoicesDone,
    );
    await Promise.all(candidates.map((o) => (platform === 'amazon' ? amazonOrder(o, origin, ctx) : jiomartOrder(o, origin, ctx))));
  }
  await closeWorkerWindow();
  const zips = await zipPending();
  emit('invoices', `${ctx.fetched} new invoice(s) · ${zips} ZIP(s)`, { done: true, ok: true });
  if (ctx.fetched) notify('Invoices saved', `${ctx.fetched} new invoice(s) in ${zips} ZIP file(s)`);
  return { fetched: ctx.fetched, zips };
}

async function amazonOrder(o: OrderRow, origin: string, ctx: Ctx) {
  const r = await read(`${origin}${AMAZON.orders.invoicePopoverUrl(o.orderId)}`, 'amazon.invoiceLinks', { args: { orderId: o.orderId }, op: 'invoiceLinks' });
  if (!r.ok) {
    await logError('fetch-failed', `Order ${o.orderId}: invoice list unreadable — retried next check`, 'amazon', o.key);
    return;
  }
  const refs = r.value as InvoiceRef[];
  let allOk = true;
  for (const ref of refs) allOk = (await storeInvoice('amazon', o, ref, ctx)) && allOk;
  // Only stop checking once every invoice of a finished order is safely stored.
  if (o.isFinal && refs.length && allOk) await db.orders.update(o.key, { invoicesDone: 1 });
}

/** JioMart: per shipment, JioMart's details endpoint gives the invoice token; the PDF comes through its invoice link. */
async function jiomartOrder(o: OrderRow, origin: string, ctx: Ctx) {
  const shipmentIds = o.detail.shipmentIds ?? [];
  if (!shipmentIds.length) return; // the next check fills shipment IDs in
  let found = 0;
  let allOk = true;
  for (const sid of shipmentIds) {
    const r = await read(`${origin}${JIOMART.orders.shipmentDetails(sid)}`, 'jiomart.api.shipment', { args: { orderId: o.orderId }, op: 'jiomart.invoiceToken' });
    if (!r.ok) {
      allOk = false;
      await logError('fetch-failed', `Order ${o.orderId}: invoice details for shipment ${sid} unreadable (${r.attempts.map((x) => `${x.layer}:${x.error}`).join(' | ')}) — retried next check`, 'jiomart', o.key);
      continue;
    }
    for (const t of (r.value as JioOrderPage).invoiceTokens) {
      found++;
      allOk = (await storeInvoice('jiomart', o, { orderId: o.orderId, invoiceNo: t.invoiceNo, url: `${origin}${JIOMART.orders.invoicePdf(t.token)}` }, ctx)) && allOk;
    }
  }
  if (o.isFinal && found && allOk) await db.orders.update(o.key, { invoicesDone: 1 });
}

/** Downloads and stores one invoice unless it is already known by key or by file hash. Returns false on failure. */
async function storeInvoice(platform: Platform, o: OrderRow, ref: InvoiceRef, ctx: Ctx): Promise<boolean> {
  const key = invoiceKey(platform, o.accountId, o.orderId, ref.invoiceNo);
  if (ctx.known.has(key)) return true; // already downloaded once: never again
  let bytes: Uint8Array;
  try {
    bytes = await fetchPdf(platform, ref.url);
  } catch (e) {
    await logError('fetch-failed', `Order ${o.orderId}: invoice ${ref.invoiceNo} not downloaded (${e instanceof Error ? e.message : e}) — retried next check`, platform, o.key);
    return false;
  }
  const hash = await sha256Hex(bytes);
  const row: InvoiceRow = {
    key, platform, accountId: o.accountId, orderKey: o.key, orderId: o.orderId, invoiceNo: ref.invoiceNo, url: ref.url,
    sha256: hash, size: bytes.byteLength, fetchedAt: new Date().toISOString(), fetchedDay: ctx.today,
  };
  ctx.known.add(key);
  if (ctx.knownHashes.has(hash)) {
    // Same PDF under a different link: record it so it is never fetched again, but don't zip it twice.
    row.zippedAt = 'duplicate';
    await db.invoices.put(row);
    return true;
  }
  ctx.knownHashes.add(hash);
  await db.transaction('rw', db.invoices, db.invoiceBlobs, async () => {
    await db.invoices.put(row);
    await db.invoiceBlobs.put({ key, blob: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }) });
  });
  ctx.fetched++;
  emit('invoices', `Invoice ${ref.invoiceNo} · ${o.orderId}`, { ok: true });
  return true;
}

/** A: direct fetch from the worker; B: fetch inside an open site tab. */
async function fetchPdf(platform: Platform, url: string): Promise<Uint8Array> {
  const pool = await poolFor(platform);
  return pool.run(async () => {
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) {
        const b = new Uint8Array(await res.arrayBuffer());
        if (isPdf(b)) return b;
      }
    } catch {}
    // B: fetch from inside a page of the site (carries the login cookie): an open tab, or a light background one.
    type Bytes = { ok: boolean; b64?: string; error?: string };
    const msg = { kind: 'cs' as const, op: 'fetchBytes' as const, url };
    const tab = await findSiteTab(platform);
    let r: Bytes | null = null;
    if (tab?.id) r = await sendToTab<Bytes>(tab.id, msg).catch(() => null);
    const origin = new URL(url).origin;
    if (!r?.ok) r = await withWorkerTab(async (tabId) => { await ensureSitePage(tabId, origin); return sendToTab<Bytes>(tabId, msg); }, sitePageUrl(origin));
    if (!r.ok || !r.b64) throw new Error(r.error ?? 'invoice fetch failed');
    const b = Uint8Array.from(atob(r.b64), (c) => c.charCodeAt(0));
    if (!isPdf(b)) throw new Error('not a PDF (session expired?)');
    return b;
  });
}

const isPdf = (b: Uint8Array) => PDF_MAGIC.every((m, i) => b[i] === m);

/**
 * Zips every stored invoice not yet zipped, one ZIP per fetch day and account
 * (so a day that failed to zip is caught up under its own date). Rows are
 * claimed before the download starts, so a crash can never produce a second
 * ZIP of the same invoices; unclaimed rows stay visible for "Re-zip".
 */
export async function zipPending(filter: (r: InvoiceRow) => boolean = (r) => !!r.fetchedDay && !r.zippedAt): Promise<number> {
  const rows = (await db.invoices.toArray()).filter(filter);
  const groups = new Map<string, InvoiceRow[]>();
  for (const r of rows) {
    const g = `${r.fetchedDay}|${r.platform}|${r.accountId}`;
    groups.set(g, [...(groups.get(g) ?? []), r]);
  }
  let made = 0;
  for (const [g, list] of groups) {
    const [day, platform, acct] = g.split('|');
    const account = (await db.accounts.get(acct))?.displayName ?? acct.split(':')[1] ?? acct;
    const filename = zipDownloadPath(day, platform, account, cleanFolder((await getSettings()).invoiceFolder));
    const previous = new Map(list.map((r) => [r.key, { zippedAt: r.zippedAt, zipName: r.zipName }]));
    const claimedAt = new Date().toISOString();
    await db.invoices.bulkUpdate(list.map((r) => ({ key: r.key, changes: { zippedAt: claimedAt, zipName: filename } })));
    try {
      const z = await toOffscreen<{ ok: boolean; url?: string; message?: string }>({ kind: 'offscreen', op: 'buildZip', invoiceKeys: list.map((r) => r.key) });
      if (!z.ok || !z.url) throw new Error(z.message ?? 'ZIP build failed');
      await chrome.downloads.download({ url: z.url, filename, conflictAction: 'uniquify', saveAs: false });
      setTimeout(() => toOffscreen({ kind: 'offscreen', op: 'revoke', url: z.url! }).catch(() => {}), 120000);
      made++;
    } catch (e) {
      // Release the claim so the next run zips them.
      await db.invoices.bulkUpdate(list.map((r) => ({ key: r.key, changes: previous.get(r.key)! })));
      await logError('fetch-failed', `ZIP ${filename} not created: ${e instanceof Error ? e.message : e}`, platform as any);
    }
  }
  return made;
}
