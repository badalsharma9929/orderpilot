import { describe, it, expect, beforeEach } from 'vitest';
import { OrderPilotDB } from '@/db/dexie';
import { saveOrderRead, openOrders, mergeDetail } from '@/db/repo';
import type { OrderDetail } from '@/core/schemas';

let db: OrderPilotDB;
beforeEach(async () => { db = new OrderPilotDB(`t-${Math.random()}`); await db.open(); });

const base = (status: any, extra: Partial<OrderDetail> = {}): OrderDetail => ({
  platform: 'amazon', orderId: '403-1', orderDate: '2026-10-01', total: 100,
  items: [{ title: 'Pen', qty: 2 }],
  tracking: { status, rawStatus: status, events: [] },
  ...extra,
});

describe('saveOrderRead', () => {
  it('adds a status event only when the status changes', async () => {
    const day1 = new Date('2026-10-09T09:00:00');
    await saveOrderRead(base('Ordered'), 'amazon:acc', 'A', { db, now: day1 });
    await saveOrderRead(base('Ordered'), 'amazon:acc', 'A', { db, now: new Date('2026-10-09T12:00:00') });
    const r = await saveOrderRead(base('Shipped'), 'amazon:acc', 'A', { db, now: new Date('2026-10-10T09:00:00') });
    expect(r.statusChanged).toBe(true);
    expect(r.previous).toBe('Ordered');
    expect(await db.statusEvents.count()).toBe(2);
  });

  it('keeps exactly one snapshot per order per day', async () => {
    await saveOrderRead(base('Ordered'), 'a', 'A', { db, now: new Date('2026-10-09T09:00:00') });
    await saveOrderRead(base('Packed'), 'a', 'A', { db, now: new Date('2026-10-09T18:00:00') });
    await saveOrderRead(base('Shipped'), 'a', 'A', { db, now: new Date('2026-10-10T09:00:00') });
    const snaps = await db.dailySnapshots.toArray();
    expect(snaps.map((s) => [s.day, s.status])).toEqual([['2026-10-09', 'Packed'], ['2026-10-10', 'Shipped']]);
  });

  it('stops listing an order as open once it is final', async () => {
    await saveOrderRead(base('In transit'), 'a', 'A', { db });
    expect(await openOrders(db)).toHaveLength(1);
    await saveOrderRead(base('Delivered'), 'a', 'A', { db });
    expect(await openOrders(db)).toHaveLength(0);
  });

  it('never lets a weaker read erase a known AWB', () => {
    const prev = base('Shipped', { tracking: { status: 'Shipped', rawStatus: 'Shipped', awb: 'AWB1', courier: 'Delhivery', events: [] } });
    const next = base('In transit', { items: [], tracking: { status: 'In transit', rawStatus: 'In transit', events: [] } });
    const m = mergeDetail(prev, next);
    expect(m.tracking?.awb).toBe('AWB1');
    expect(m.tracking?.status).toBe('In transit');
    expect(m.items).toHaveLength(1);
  });
});
