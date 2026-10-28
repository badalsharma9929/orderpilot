// JioMart daily check. The orders API returns full shipments, so one request
// per 20 orders saves complete records; open orders are then refreshed from
// JioMart's own shipment-details endpoint (fresher status + invoice token).

import { JIOMART } from '@/adapters/jiomart/selectors';
import type { JioOrderEntry, JioOrderPage } from '@/adapters/jiomart/parsers';
import { missingFields, type OrderDetail, type Source } from '@/core/schemas';
import { normalizeStatus } from '@/core/status';
import { db, type OrderRow } from '@/db/dexie';
import { accountId, localDay, openOrders, orderKey, saveOrderRead } from '@/db/repo';
import { getSettings } from '@/core/settings';
import { emit } from '../progress';
import { logError, resolveOrderErrors, resolveSiteErrors } from '../errors';
import { read } from '../read';
import type { SweepSummary } from './sweep';

export async function sweepJiomart(s: SweepSummary, origin: string) {
  const known = (await db.accounts.where('platform').equals('jiomart').count()) > 0;
  const open = await openOrders(db, 'jiomart');

  // 1. Account: session API (A/B), then the page data (A/B/C).
  let name: string | undefined;
  const api = await read(`${origin}${JIOMART.orders.api.session}`, 'jiomart.api.session', { op: 'jiomart.account', validate: (v) => (v?.name ? [] : ['account']) });
  if (api.ok) name = api.value?.name;
  if (!name) {
    const page = await read(`${origin}/profile`, 'jiomart.account', { op: 'jiomart.account.page', validate: (v) => (v?.name ? [] : ['account']) });
    if (page.ok) name = page.value?.name;
  }
  if (!name) {
    if (known || open.length) {
      s.needsLogin.push(...new Set(open.map((o) => o.accountId).concat(open.length ? [] : ['jiomart'])));
      await logError('login-needed', `JioMart is signed out; ${open.length} open orders waiting`, 'jiomart');
    }
    emit('sweep', 'JioMart: not signed in — log in to JioMart and run the check again', { ok: false });
    return;
  }
  const acct = accountId('jiomart', name);
  await resolveSiteErrors('jiomart');
  await db.accounts.put({ id: acct, platform: 'jiomart', displayName: name, lastSeenAt: new Date().toISOString() });
  emit('sweep', `JioMart: ${name}`, { ok: true, layer: api.ok ? api.layer : 'C' });
  for (const other of new Set(open.filter((o) => o.accountId !== acct).map((o) => o.accountId))) s.needsLogin.push(other);

  // 2. Discovery: every page until the list passes the oldest open order.
  const listed = await discover(origin, acct, open, s);

  // 3. Refresh open orders (and finished ones still missing fields) in parallel.
  const today = localDay();
  const recent = new Date(Date.now() - (await getSettings()).retryIncompleteDays * 864e5).toISOString().slice(0, 10);
  const all = await db.orders.where('accountId').equals(acct).toArray();
  const targets = all.filter((o) => o.platform === 'jiomart' && (
    !o.isFinal ||
    (o.gaps.length && (!o.detail.items.length || ((o.orderDate ?? today) >= recent && (!o.lastCheckedAt || localDay(new Date(o.lastCheckedAt)) !== today))))
  ));
  const results = await Promise.allSettled(targets.map((o) => refreshJiomartOrder(origin, acct, o, listed.get(o.orderId), s)));
  for (const [i, r] of results.entries()) {
    if (r.status === 'rejected') {
      s.failed++;
      await logError('fetch-failed', `JioMart order ${targets[i].orderId}: ${String(r.reason?.message ?? r.reason)}`, 'jiomart', targets[i].key);
    }
  }
}

async function discover(origin: string, acct: string, open: OrderRow[], s: SweepSummary) {
  const listed = new Map<string, JioOrderEntry>();
  const months = (await getSettings()).discoveryMonths;
  const backfillKey = `backfill:${acct}`;
  const backfilled = !!(await chrome.storage.local.get(backfillKey))[backfillKey];
  const oldestOpen = open.map((o) => o.orderDate).filter(Boolean).sort()[0];
  // Whole history on the first check (every page to the end); afterwards stop once
  // pages are older than the oldest open order / last 45 days. "months" limits it on purpose.
  const cutoff = months > 0
    ? oldestOpen ?? new Date(Date.now() - months * 30 * 864e5).toISOString().slice(0, 10)
    : backfilled ? oldestOpen ?? new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10) : '0000-00-00';
  let reachedEnd = false;

  for (let page = 1; page <= 500; page++) {
    const r = await read(`${origin}${JIOMART.orders.api.orders(page)}`, 'jiomart.api.orders', { op: 'jiomart.orders' });
    if (!r.ok) {
      if (page === 1) await discoverFromPage(origin, acct, listed, s);
      else {
        s.failed++;
        await logError('fetch-failed', `JioMart order list page ${page} unreadable — older orders may be missing until the next check`, 'jiomart');
      }
      break;
    }
    const { orders, pages, hasNext } = r.value;
    for (const [i, e] of orders.entries()) {
      listed.set(e.orderId, e);
      const isNew = !(await db.orders.get(orderKey('jiomart', e.orderId)));
      if (isNew) s.discovered++;
      // The list already carries full shipment data: save it as a complete record.
      const p = pages[i];
      if (p?.detail.orderId) await saveOrderRead({ ...p.detail, shipmentIds: p.shipmentIds }, acct, r.layer as Source);
    }
    emit('sweep', `JioMart orders page ${page}: ${orders.length}`, { ok: true, layer: r.layer });
    const allOlder = orders.length > 0 && orders.every((e) => e.orderDate && e.orderDate < cutoff);
    if (!hasNext || !orders.length) { reachedEnd = true; break; }
    if (allOlder) break;
  }
  if (reachedEnd && !backfilled) {
    await chrome.storage.local.set({ [backfillKey]: true });
    emit('sweep', `JioMart: full order history read (${listed.size} orders)`, { ok: true });
  }
  return listed;
}

/** Layer C/D fallback for discovery: the rendered My Orders page. */
async function discoverFromPage(origin: string, acct: string, listed: Map<string, JioOrderEntry>, s: SweepSummary) {
  const r = await read(`${origin}${JIOMART.orders.listPath}`, 'jiomart.orderListDom', {
    op: 'jiomart.orders.page', claude: 'orderList', validate: (v) => (v.orders.length ? [] : ['orders']),
  });
  if (!r.ok) {
    s.failed++;
    await logError('fetch-failed', 'JioMart order list unreadable on every layer', 'jiomart');
    return;
  }
  for (const e of r.value.orders as JioOrderEntry[]) {
    listed.set(e.orderId, e);
    if (!(await db.orders.get(orderKey('jiomart', e.orderId)))) {
      s.discovered++;
      await saveOrderRead(stub(e), acct, r.layer as Source);
    }
  }
}

function stub(e: JioOrderEntry): OrderDetail {
  return {
    platform: 'jiomart', orderId: e.orderId, orderDate: e.orderDate, total: e.total, items: [], shipmentIds: e.shipmentIds?.length ? e.shipmentIds : undefined,
    tracking: e.status ? { status: normalizeStatus(e.status), rawStatus: e.status, events: [] } : undefined,
  };
}

/**
 * One order: A order API (all shipments) → JioMart shipment details per shipment
 * (fresher status) → rendered shipment page (C) / Claude (D).
 */
export async function refreshJiomartOrder(origin: string, acct: string, o: Pick<OrderRow, 'orderId'> & { detail?: OrderDetail }, entry?: JioOrderEntry, s?: SweepSummary) {
  const orderId = o.orderId;
  let page: JioOrderPage | null = null;
  let source: Source = 'A';
  const valid = (p: JioOrderPage) => missingFields(p.detail, ['orderId', 'items', 'total']);

  const byOrder = await read(`${origin}${JIOMART.orders.api.order(orderId)}`, 'jiomart.api.order', { args: { orderId }, op: 'jiomart.order', validate: valid });
  if (byOrder.ok) { page = byOrder.value; source = byOrder.layer as Source; }

  const shipmentIds = page?.shipmentIds.length ? page.shipmentIds : entry?.shipmentIds?.length ? entry.shipmentIds : o.detail?.shipmentIds ?? [];
  // Fresher status/timeline from JioMart's own endpoint, for the first shipment that is still moving.
  for (const sid of shipmentIds) {
    const d = await read(`${origin}${JIOMART.orders.shipmentDetails(sid)}`, 'jiomart.api.shipment', { args: { orderId }, op: 'jiomart.shipment' });
    if (!d.ok) continue;
    if (!page) { page = d.value; source = d.layer as Source; break; }
    if (d.value.detail.tracking && (shipmentIds.length === 1 || d.value.detail.tracking.status !== 'Delivered')) {
      page = { ...page, detail: { ...page.detail, tracking: d.value.detail.tracking } };
      break;
    }
  }
  if (!page) {
    for (const sid of shipmentIds) {
      const r = await read(`${origin}${JIOMART.orders.shipmentPath(sid)}`, 'jiomart.shipmentDom', {
        args: { orderId }, op: 'jiomart.shipment.page', claude: 'orderDetail',
        validate: (v) => missingFields((v as JioOrderPage).detail, ['orderId', 'tracking.status']),
      });
      if (r.ok) { page = r.value as JioOrderPage; source = r.layer as Source; break; }
    }
  }
  if (!page) {
    if (s) s.failed++;
    await logError('fetch-failed', `JioMart order ${orderId}: unreadable on every layer — retried next check`, 'jiomart', orderKey('jiomart', orderId));
    return;
  }
  const detail: OrderDetail = { ...page.detail, platform: 'jiomart', orderId, shipmentIds: page.shipmentIds.length ? page.shipmentIds : shipmentIds };
  const saved = await saveOrderRead(detail, acct, source);
  await resolveOrderErrors(saved.row.key, saved.row.gaps.length > 0);
  if (s) s.checked++;
  if (saved.statusChanged && saved.previous) s?.changed.push({ orderId, from: saved.previous, to: saved.row.status });
  if (saved.row.gaps.length) {
    if (s) s.incomplete++;
    await logError('incomplete', `JioMart order ${orderId}: missing ${saved.row.gaps.join(', ')}`, 'jiomart', saved.row.key);
  }
  emit('sweep', `${orderId}: ${saved.row.status}`, { ok: true, layer: source, note: saved.row.gaps.length ? `missing ${saved.row.gaps.join(', ')}` : undefined });
}
