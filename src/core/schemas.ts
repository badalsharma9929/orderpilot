import { z } from 'zod';
import { STATUSES } from './status';

export const PLATFORMS = ['amazon', 'flipkart', 'jiomart'] as const;
export type Platform = (typeof PLATFORMS)[number];
export type Source = 'A' | 'B' | 'C' | 'D' | 'manual';

export const OrderItemSchema = z.object({
  productId: z.string().optional(),
  title: z.string().min(1),
  qty: z.number().int().positive(),
  unitPrice: z.number().nonnegative().optional(),
  seller: z.string().optional(),
  url: z.string().optional(),
});

export const TrackingEventSchema = z.object({
  at: z.string(),          // ISO or site text as shown
  text: z.string(),
  location: z.string().optional(),
});

export const TrackingSchema = z.object({
  status: z.enum(STATUSES),
  rawStatus: z.string(),
  courier: z.string().optional(),
  awb: z.string().optional(),
  eta: z.string().optional(),
  deliveredAt: z.string().optional(),
  events: z.array(TrackingEventSchema).default([]),
});

export const OrderDetailSchema = z.object({
  platform: z.enum(PLATFORMS),
  orderId: z.string().min(3),
  orderDate: z.string().optional(),
  items: z.array(OrderItemSchema).default([]),
  total: z.number().nonnegative().optional(),
  subtotal: z.number().nonnegative().optional(),
  discount: z.number().optional(),
  couponCode: z.string().optional(),
  paymentMode: z.string().optional(),
  shipCity: z.string().optional(),
  pincode: z.string().optional(),
  invoiceAvailable: z.boolean().optional(),
  /** JioMart: an order ships as one or more shipments, each tracked and invoiced separately. */
  shipmentIds: z.array(z.string()).optional(),
  tracking: TrackingSchema.optional(),
});

export const InvoiceRefSchema = z.object({
  orderId: z.string(),
  invoiceNo: z.string().min(1),
  url: z.string().url(),
});

export type OrderItem = z.infer<typeof OrderItemSchema>;
export type Tracking = z.infer<typeof TrackingSchema>;
export type OrderDetail = z.infer<typeof OrderDetailSchema>;
export type InvoiceRef = z.infer<typeof InvoiceRefSchema>;

// Fields that must be present before a record counts as complete. Missing ones
// push the fetch to the next layer and, if every layer fails, flag the order.
export const REQUIRED = {
  order: ['orderId', 'orderDate', 'items', 'total', 'tracking.status'],
  tracking: ['status', 'rawStatus'],
  // Courier/AWB only exist once shipped; checked separately by `trackingGaps`.
} as const;

export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), obj);
}

function present(v: unknown) {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'number') return Number.isFinite(v);
  return true;
}

export function missingFields(record: unknown, required: readonly string[]): string[] {
  return required.filter((p) => !present(getPath(record, p)));
}

/** Extra gaps that only apply once a shipment exists. */
export function trackingGaps(t: Tracking | undefined, platform?: string): string[] {
  if (!t) return ['tracking'];
  // JioMart delivers mostly with its own fleet: no courier name or AWB exists to collect.
  const needsCarrier = platform !== 'jiomart';
  const shipped = ['Shipped', 'In transit', 'Out for delivery', 'Delivered', 'Delayed'].includes(t.status);
  const gaps: string[] = [];
  if (t.status === 'Unknown') gaps.push('tracking.status');
  if (needsCarrier && shipped && !t.courier) gaps.push('tracking.courier');
  if (needsCarrier && shipped && !t.awb) gaps.push('tracking.awb');
  if (shipped && t.status !== 'Delivered' && !t.eta) gaps.push('tracking.eta');
  return gaps;
}

export function orderGaps(o: Partial<OrderDetail>): string[] {
  const base = missingFields(o, REQUIRED.order);
  return [...new Set([...base, ...trackingGaps(o.tracking, o.platform)])];
}

/** 0–100; the Orders tab shows a badge below 100. */
export function completeness(o: Partial<OrderDetail>): number {
  const total = REQUIRED.order.length + 3;
  return Math.round(100 * Math.max(0, total - orderGaps(o).length) / total);
}
