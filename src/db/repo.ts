import { db as defaultDb, type OrderPilotDB, type OrderRow } from './dexie';
import { completeness, orderGaps, type OrderDetail, type Platform, type Source } from '@/core/schemas';
import { isFinal, type OrderStatus } from '@/core/status';

export const orderKey = (platform: Platform, orderId: string) => `${platform}:${orderId}`;
export const accountId = (platform: Platform, name: string) =>
  `${platform}:${name.trim().toLowerCase().replace(/\s+/g, '-')}`;

const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Fills gaps in `prev` from `next` without letting a weaker read erase known values. */
export function mergeDetail(prev: OrderDetail | undefined, next: OrderDetail): OrderDetail {
  if (!prev) return next;
  const pick = <T>(a: T | undefined, b: T | undefined) => (b === undefined || b === null || (b as any) === '' ? a : b);
  return {
    ...prev,
    ...Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && v !== null && v !== '')),
    items: next.items?.length ? next.items : prev.items,
    tracking: next.tracking
      ? {
          ...prev.tracking,
          ...next.tracking,
          courier: pick(prev.tracking?.courier, next.tracking.courier),
          awb: pick(prev.tracking?.awb, next.tracking.awb),
          eta: pick(prev.tracking?.eta, next.tracking.eta),
          events: next.tracking.events?.length ? next.tracking.events : prev.tracking?.events ?? [],
        }
      : prev.tracking,
  } as OrderDetail;
}

export interface SaveResult { row: OrderRow; statusChanged: boolean; previous?: OrderStatus }

/**
 * Upserts an order read from a site. Appends a status event only when the
 * status changed, and always writes today's snapshot (one per order per day).
 */
export async function saveOrderRead(
  detail: OrderDetail,
  acct: string,
  source: Source,
  opts: { db?: OrderPilotDB; now?: Date } = {},
): Promise<SaveResult> {
  const d = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const iso = now.toISOString();
  const key = orderKey(detail.platform, detail.orderId);

  return d.transaction('rw', [d.orders, d.statusEvents, d.dailySnapshots, d.outbox], async () => {
    const prev = await d.orders.get(key);
    const merged = mergeDetail(prev?.detail, detail);
    const status: OrderStatus = merged.tracking?.status ?? prev?.status ?? 'Ordered';
    const gaps = orderGaps(merged);
    const fieldSources = { ...(prev?.fieldSources ?? {}) };
    for (const k of Object.keys(detail)) fieldSources[k] = source;

    const row: OrderRow = {
      key,
      platform: detail.platform,
      orderId: detail.orderId,
      accountId: prev?.accountId ?? acct,
      orderDate: merged.orderDate,
      status,
      isFinal: isFinal(status) ? 1 : 0,
      completeness: completeness(merged),
      gaps,
      lastCheckedAt: iso,
      firstSeenAt: prev?.firstSeenAt ?? iso,
      detail: merged,
      fieldSources,
    };
    await d.orders.put(row);

    const statusChanged = !prev || prev.status !== status;
    if (statusChanged && merged.tracking) {
      await d.statusEvents.add({
        orderKey: key, at: iso, status, rawStatus: merged.tracking.rawStatus,
        courier: merged.tracking.courier, awb: merged.tracking.awb, eta: merged.tracking.eta,
        location: merged.tracking.events?.[0]?.location, source,
      });
    }
    await d.dailySnapshots.put({
      day: localDay(now), orderKey: key, accountId: row.accountId, platform: row.platform,
      status, takenAt: iso, snapshot: merged,
    });
    await d.outbox.add({ table: 'orders', rowKey: key, op: 'upsert', at: iso });
    return { row, statusChanged, previous: prev?.status };
  });
}

export async function openOrders(d: OrderPilotDB = defaultDb, platform?: Platform) {
  const rows = await d.orders.where('isFinal').equals(0).toArray();
  return platform ? rows.filter((r) => r.platform === platform) : rows;
}

export { localDay };
