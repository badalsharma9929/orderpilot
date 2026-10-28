// Daily status sweep: find every order (no gaps), then refresh detail +
// tracking for all open orders in parallel through the fetch ladder.

import { AMAZON } from '@/adapters/amazon/selectors';
import type { AmazonOrderPage, OrderListEntry } from '@/adapters/amazon/parsers';
import type { OrderDetail, Platform, Source, Tracking } from '@/core/schemas';
import { missingFields } from '@/core/schemas';
import { normalizeStatus } from '@/core/status';
import { db, type OrderRow } from '@/db/dexie';
import { accountId, localDay, openOrders, orderKey, saveOrderRead } from '@/db/repo';
import { getSettings } from '@/core/settings';
import { emit, exclusive, notify } from '../progress';
import { logError, resolveOrderErrors, resolveSiteErrors } from '../errors';
import { read, siteBlocked } from '../read';
import { findSiteTab } from '../tabs';
import { closeWorkerWindow } from '../tabs';
import { runInvoices } from './invoices';
import { refreshJiomartOrder, sweepJiomart } from './sweep-jiomart';
import { exportReport } from './report';

export interface SweepSummary {
  at: string;
  checked: number;
  changed: Array<{ orderId: string; from?: string; to: string }>;
  discovered: number;
  incomplete: number;
  failed: number;
  needsLogin: string[];
  ms: number;
}

export async function originFor(platform: Platform): Promise<string> {
  const key = `origin:${platform}`;
  const v = (await chrome.storage.local.get(key))[key] as string | undefined;
  return v ?? { amazon: 'https://www.amazon.in', flipkart: 'https://www.flipkart.com', jiomart: 'https://www.jiomart.com' }[platform];
}

export async function runSweep(platforms?: Platform[]): Promise<SweepSummary> {
  const sites = platforms ?? (await getSettings()).sites;
  const t0 = Date.now();
  const s: SweepSummary = { at: new Date().toISOString(), checked: 0, changed: [], discovered: 0, incomplete: 0, failed: 0, needsLogin: [], ms: 0 };
  emit('sweep', 'Sweep started');
  try {
    // Sites run one after another; inside each, orders are fetched in parallel.
    for (const p of sites) {
      if (!(await siteInUse(p))) { emit('sweep', `${p}: skipped — not used yet (run the Cart Builder there or open the site, then check again)`); continue; }
      if (siteBlocked(p)) { emit('sweep', `${p}: paused for 30 min after the site blocked a request`, { ok: false }); continue; }
      try {
        if (p === 'amazon') await sweepAmazon(s);
        else if (p === 'jiomart') await sweepJiomart(s, await originFor('jiomart'));
        else emit('sweep', `${p}: arrives in a later milestone`);
      } catch (e) {
        s.failed++;
        await logError('fetch-failed', `${p} check stopped: ${e instanceof Error ? e.message : e}`, p);
      }
    }
  } finally {
    await closeWorkerWindow();
  }
  s.ms = Date.now() - t0;
  await chrome.storage.local.set({ lastSweep: { day: localDay(), summary: s } });
  const delivered = s.changed.filter((c) => c.to === 'Delivered').length;
  const msg = `${s.checked} checked in ${(s.ms / 1000).toFixed(0)}s · ${s.changed.length} changed${delivered ? ` (${delivered} delivered)` : ''}${s.discovered ? ` · ${s.discovered} new` : ''}${s.incomplete ? ` · ${s.incomplete} incomplete` : ''}${s.needsLogin.length ? ` · log in: ${s.needsLogin.join(', ')}` : ''}`;
  emit('sweep', msg, { done: true, ok: s.failed === 0 });
  notify('Order status updated', msg);
  // Same lock as a manual run, so two invoice runs can never fetch or zip the same rows.
  const cfg = await getSettings();
  if (cfg.autoInvoices) await exclusive('invoices', runInvoices).catch((e) => emit('invoices', `Invoice run failed: ${e.message}`, { ok: false, done: true }));
  // Excel with every order and detail, after statuses and invoices are up to date.
  if (cfg.autoExcel) await exportReport();
  return s;
}

/** A site is checked only once you use it: an account, an order, a Cart Builder run, or an open tab of it. */
async function siteInUse(p: Platform): Promise<boolean> {
  if ((await db.accounts.where('platform').equals(p).count()) > 0) return true;
  if ((await db.orders.where('platform').equals(p).count()) > 0) return true;
  if ((await chrome.storage.local.get(`origin:${p}`))[`origin:${p}`]) return true;
  return !!(await findSiteTab(p));
}

async function sweepAmazon(s: SweepSummary) {
  const origin = await originFor('amazon');
  const acctRead = await read(`${origin}/gp/css/homepage.html`, 'amazon.account', { validate: (v) => (v ? [] : ['account']), op: 'account' });
  const open = await openOrders(db, 'amazon');
  if (!acctRead.ok || !acctRead.value) {
    const names = [...new Set(open.map((o) => o.accountId))];
    s.needsLogin.push(...(names.length ? names : ['amazon']));
    await logError('login-needed', `Amazon is signed out; ${open.length} open orders waiting`, 'amazon');
    emit('sweep', 'Amazon: signed out — log in and run the sweep again', { ok: false });
    return;
  }
  const acct = accountId('amazon', acctRead.value.name);
  await resolveSiteErrors('amazon');
  await db.accounts.put({ id: acct, platform: 'amazon', displayName: acctRead.value.name, lastSeenAt: new Date().toISOString() });
  emit('sweep', `Amazon: ${acctRead.value.name}`, { ok: true, layer: acctRead.layer });

  // Orders of other Amazon accounts can't be read with this session.
  for (const other of new Set(open.filter((o) => o.accountId !== acct).map((o) => o.accountId))) s.needsLogin.push(other);

  // 1. Discovery: all list pages back to the oldest open order (no gaps).
  const listed = await discoverAmazon(origin, acct, open, s);

  // 2. Refresh every open order of this account, plus finished orders that still
  //    have missing fields (once a day, for 60 days), in parallel; the pool caps concurrency.
  const today = localDay();
  const recent = new Date(Date.now() - (await getSettings()).retryIncompleteDays * 864e5).toISOString().slice(0, 10);
  const neverRead = (o: OrderRow) => !o.detail.items.length;
  const incomplete = (await db.orders.where('accountId').equals(acct).toArray()).filter((o) =>
    o.platform === 'amazon' && o.isFinal && o.gaps.length && (
      neverRead(o) || // every order gets at least one full read, whatever its age
      ((o.orderDate ?? today) >= recent && (!o.lastCheckedAt || localDay(new Date(o.lastCheckedAt)) !== today || listed.has(o.orderId)))
    ),
  );
  const targets = [...(await openOrders(db, 'amazon')).filter((o) => o.accountId === acct), ...incomplete];
  const results = await Promise.allSettled(targets.map((o) => refreshAmazonOrder(origin, acct, o.orderId, listed.get(o.orderId), s)));
  for (const [i, r] of results.entries()) {
    if (r.status === 'rejected') {
      s.failed++;
      await logError('fetch-failed', `Order ${targets[i].orderId}: ${String(r.reason?.message ?? r.reason)}`, 'amazon', targets[i].key);
    }
  }
}

async function discoverAmazon(origin: string, acct: string, open: OrderRow[], s: SweepSummary) {
  const listed = new Map<string, OrderListEntry>();
  const months = (await getSettings()).discoveryMonths;
  // Amazon's list filter has no "all time"; "All orders" reads the last 12 months.
  const span = months || 12;
  const filter = `months-${span}`;
  const oldestOpen = open.map((o) => o.orderDate).filter(Boolean).sort()[0];
  const cutoff = oldestOpen ?? new Date(Date.now() - span * 30 * 864e5).toISOString().slice(0, 10);

  let expectMore = false;
  for (let page = 0; page < 30; page++) {
    const urls = AMAZON.orders.listUrls(page * 10, filter);
    let entries: OrderListEntry[] = [];
    let next: string | null = null;
    for (const u of page === 0 ? urls : urls.slice(0, 1)) {
      const r = await read(`${origin}${u}`, 'amazon.orderList', { claude: 'orderList', op: 'orderList', validate: (v) => (v.orders.length || page > 0 ? [] : ['orders']) });
      if (r.ok && r.value.orders.length) { entries = r.value.orders; next = r.value.nextHref; break; }
    }
    if (!entries.length) {
      // An empty page after a "next" link is a failed read, not the end of the list.
      if (page === 0 || expectMore) {
        s.failed++;
        await logError('fetch-failed', `Amazon order list page ${page + 1} unreadable on every layer — older orders may be missing until the next check`, 'amazon');
        emit('sweep', `Order list page ${page + 1} unreadable on every layer`, { ok: false });
      }
      break;
    }
    for (const e of entries) {
      listed.set(e.orderId, e);
      const known = await db.orders.get(orderKey('amazon', e.orderId));
      if (!known) {
        s.discovered++;
        await saveOrderRead(stubFrom(e), acct, 'A');
      }
    }
    const allOlder = entries.every((e) => e.orderDate && e.orderDate < cutoff);
    emit('sweep', `Order list page ${page + 1}: ${entries.length} orders`, { ok: true });
    if (!next || allOlder) break;
    expectMore = true;
  }
  return listed;
}

function stubFrom(e: OrderListEntry): OrderDetail {
  return {
    platform: 'amazon', orderId: e.orderId, orderDate: e.orderDate, total: e.total, items: [],
    tracking: e.status ? { status: normalizeStatus(e.status), rawStatus: e.status, events: [] } : undefined,
  };
}

export async function refreshAmazonOrder(origin: string, acct: string, orderId: string, listEntry: OrderListEntry | undefined, s?: SweepSummary) {
  const detailRead = await read(`${origin}${AMAZON.orders.detailUrls(orderId)[0]}`, 'amazon.orderDetail', {
    args: { orderId },
    claude: 'orderDetail',
    op: 'orderDetail',
    validate: (v) => missingFields(v.detail, ['orderId', 'orderDate', 'items', 'total']),
  });
  if (!detailRead.ok) {
    if (s) s.failed++;
    await logError('fetch-failed', `Order ${orderId}: detail unreadable (${detailRead.attempts.map((a) => `${a.layer}:${a.error}`).join(' | ')})`, 'amazon', orderKey('amazon', orderId));
    return;
  }
  const page = detailRead.value as AmazonOrderPage;
  const detail: OrderDetail = { ...page.detail, platform: 'amazon', orderId };
  let source: Source = detailRead.layer as Source;

  // Tracking page has the courier, AWB and events; skip it for cancelled orders.
  const cancelled = /cancel/i.test(detail.tracking?.rawStatus ?? listEntry?.status ?? '');
  const trackHref = page.trackHrefs[0];
  if (trackHref && !cancelled) {
    const t = await read(new URL(trackHref, origin).toString(), 'amazon.tracking', {
      claude: 'tracking', op: 'tracking',
      validate: (v) => (v.status === 'Unknown' ? ['status'] : []),
    });
    if (t.ok) {
      detail.tracking = { ...(detail.tracking ?? {}), ...(t.value as Tracking) };
      if (t.layer === 'D') source = 'D';
    }
  }
  if (!detail.tracking && listEntry?.status) detail.tracking = { status: normalizeStatus(listEntry.status), rawStatus: listEntry.status, events: [] };

  const saved = await saveOrderRead(detail, acct, source);
  await resolveOrderErrors(saved.row.key, saved.row.gaps.length > 0);
  if (s) s.checked++;
  if (saved.statusChanged && saved.previous) s?.changed.push({ orderId, from: saved.previous, to: saved.row.status });
  if (saved.row.gaps.length) {
    if (s) s.incomplete++;
    await logError('incomplete', `Order ${orderId}: missing ${saved.row.gaps.join(', ')}`, 'amazon', saved.row.key);
  }
  emit('sweep', `${orderId}: ${saved.row.status}`, { ok: true, layer: detailRead.layer, note: saved.row.gaps.length ? `missing ${saved.row.gaps.join(', ')}` : undefined });
}

/** Flow 2: the thank-you page reported new order IDs. */
export async function captureOrders(platform: Platform, orderIds: string[], account: string | undefined, origin: string) {
  if (platform !== 'amazon' && platform !== 'jiomart') return;
  await chrome.storage.local.set({ [`origin:${platform}`]: origin });
  // JioMart's page may only show initials; the account the Cart Builder last saw is more reliable.
  const lastSeen = (await db.accounts.where('platform').equals(platform).sortBy('lastSeenAt')).pop()?.id;
  const acct = platform === 'jiomart' ? lastSeen ?? (account ? accountId(platform, account) : `${platform}:unknown`)
    : account ? accountId(platform, account) : lastSeen ?? `${platform}:unknown`;
  emit('sweep', `Captured order ${orderIds.join(', ')}`, { ok: true });
  for (const id of orderIds) {
    if (!(await db.orders.get(orderKey(platform, id)))) {
      await saveOrderRead({ platform, orderId: id, orderDate: localDay(), items: [], tracking: { status: 'Ordered', rawStatus: 'Order placed', events: [] } }, acct, 'A');
    }
  }
  // Give the site a moment to publish the order, then read it fully.
  setTimeout(() => Promise.allSettled(orderIds.map((id) => platform === 'jiomart'
    ? refreshJiomartOrder(origin, acct, { orderId: id })
    : refreshAmazonOrder(origin, acct, id, undefined))), 8000);
  notify('Order captured', `${orderIds.length} order(s) saved: ${orderIds.join(', ')}`);
}
