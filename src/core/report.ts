// The Excel report: every order with all extracted details, one sheet per view.

import { db, type OrderPilotDB } from '@/db/dexie';
import { buildXlsx, type Sheet } from './xlsx';

const day = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s ?? '');
const when = (s?: string) => {
  if (!s) return '';
  const d = new Date(s);
  return /^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(d.getTime())
    ? d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : s;
};

export async function buildReportSheets(d: OrderPilotDB = db): Promise<Sheet[]> {
  const [orders, accounts, events, invoices, snaps] = await Promise.all([
    d.orders.toArray(), d.accounts.toArray(), d.statusEvents.toArray(), d.invoices.toArray(), d.dailySnapshots.toArray(),
  ]);
  const acct = new Map(accounts.map((a) => [a.id, a.displayName]));
  const name = (id: string) => acct.get(id) ?? id.split(':')[1] ?? id;
  orders.sort((a, b) => (b.orderDate ?? '').localeCompare(a.orderDate ?? ''));
  const invCount = new Map<string, number>();
  for (const i of invoices) if (i.zippedAt !== 'duplicate') invCount.set(i.orderKey, (invCount.get(i.orderKey) ?? 0) + 1);

  const ordersSheet: Sheet = {
    name: 'Orders',
    columns: ['Site', 'Account', 'Order ID', 'Order date', 'Status', 'Site status text', 'Finished', 'Total ₹', 'Subtotal ₹', 'Savings ₹', 'Payment',
      'City', 'Pincode', 'Courier', 'Tracking / AWB', 'Expected', 'Delivered', 'Items', 'Total qty', 'Item summary', 'Shipment IDs',
      'Invoices saved', 'Complete %', 'Missing fields', 'First seen', 'Last checked'],
    rows: orders.map((o) => {
      const x = o.detail, t = x.tracking;
      return [o.platform, name(o.accountId), o.orderId, day(o.orderDate), o.status, t?.rawStatus, o.isFinal ? 'Yes' : 'No', x.total, x.subtotal, x.discount,
        x.paymentMode, x.shipCity, x.pincode, t?.courier, t?.awb, when(t?.eta), when(t?.deliveredAt), x.items.length,
        x.items.reduce((s, i) => s + (i.qty || 0), 0), x.items.map((i) => `${i.qty} × ${i.title}`).join(' | '), (x.shipmentIds ?? []).join(', '),
        invCount.get(o.key) ?? 0, o.completeness, o.gaps.join(', '), when(o.firstSeenAt), when(o.lastCheckedAt)];
    }),
  };

  const itemsSheet: Sheet = {
    name: 'Items',
    columns: ['Site', 'Account', 'Order ID', 'Order date', 'Status', 'Item', 'Qty', 'Unit price ₹', 'Line total ₹', 'Seller', 'Product ID', 'Product link'],
    rows: orders.flatMap((o) => o.detail.items.map((i) => [o.platform, name(o.accountId), o.orderId, day(o.orderDate), o.status, i.title, i.qty, i.unitPrice,
      i.unitPrice != null ? Math.round(i.unitPrice * i.qty * 100) / 100 : null, i.seller, i.productId,
      i.url ? (i.url.startsWith('http') ? i.url : `${o.platform === 'jiomart' ? 'https://www.jiomart.com' : 'https://www.amazon.in'}${i.url}`) : ''])),
  };

  const trackingSheet: Sheet = {
    name: 'Tracking',
    columns: ['Order ID', 'Time', 'Step', 'Location'],
    rows: orders.flatMap((o) => (o.detail.tracking?.events ?? []).map((e) => [o.orderId, when(e.at), e.text, e.location])),
  };

  const byKey = new Map(orders.map((o) => [o.key, o]));
  const historySheet: Sheet = {
    name: 'Status history',
    columns: ['Order ID', 'Recorded at', 'Status', 'Site text', 'Courier', 'Tracking / AWB', 'Expected', 'Read by layer'],
    rows: events.sort((a, b) => a.at.localeCompare(b.at)).map((e) => [byKey.get(e.orderKey)?.orderId ?? e.orderKey, when(e.at), e.status, e.rawStatus, e.courier, e.awb, when(e.eta), e.source]),
  };

  const invoicesSheet: Sheet = {
    name: 'Invoices',
    columns: ['Site', 'Account', 'Order ID', 'Invoice no', 'Downloaded on', 'Size KB', 'ZIP file', 'State'],
    rows: invoices.map((i) => [i.platform, name(i.accountId), i.orderId, i.invoiceNo, i.fetchedDay, i.size ? Math.round(i.size / 102.4) / 10 : null,
      i.zipName?.split('/').pop(), i.zippedAt === 'duplicate' ? 'duplicate skipped' : i.zippedAt ? 'zipped' : 'pending']),
  };

  const dailySheet: Sheet = {
    name: 'Daily log',
    columns: ['Day', 'Site', 'Account', 'Order ID', 'Status', 'Site status text', 'Total ₹'],
    rows: snaps.sort((a, b) => b.day.localeCompare(a.day)).map((s) => [s.day, s.platform, name(s.accountId), s.snapshot.orderId, s.status, s.snapshot.tracking?.rawStatus, s.snapshot.total]),
  };

  return [ordersSheet, itemsSheet, trackingSheet, historySheet, invoicesSheet, dailySheet];
}

export async function buildReport(d: OrderPilotDB = db): Promise<{ bytes: Uint8Array; orders: number }> {
  const sheets = await buildReportSheets(d);
  return { bytes: await buildXlsx(sheets), orders: sheets[0].rows.length };
}

export const reportFileName = (dayIso: string) => `OrderPilot_orders_${dayIso}.xlsx`;
