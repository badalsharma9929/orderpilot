// Normalises status text from all three sites to one vocabulary.
// Ported and extended from order-shipment-dashboard/app.js (mapDeliveryStatus,
// isCancelledStatus, isNotDispatched).

export const STATUSES = [
  'Ordered', 'Packed', 'Shipped', 'In transit', 'Out for delivery',
  'Delivered', 'Cancelled', 'Returned', 'Delayed', 'Unknown',
] as const;
export type OrderStatus = (typeof STATUSES)[number];

export const FINAL_STATUSES: ReadonlySet<OrderStatus> = new Set(['Delivered', 'Cancelled', 'Returned']);

// Order matters: the first rule that matches wins, so specific phrases go first
// ("not delivered" must not read as Delivered; "out for delivery" before "delivery").
const RULES: Array<[RegExp, OrderStatus]> = [
  [/\b(refund(ed)?|return(ed)?|replacement (completed|picked))\b/i, 'Returned'],
  [/\b(cancel+ed|cancel+ation (completed|successful)|order cancel+ed)\b/i, 'Cancelled'],
  [/\b(not delivered|undelivered|delivery attempt(ed)? failed|failed delivery)\b/i, 'Delayed'],
  [/\bout for delivery\b/i, 'Out for delivery'],
  [/\b(delivered|delivery completed)\b/i, 'Delivered'],
  [/\b(delayed|running late|late delivery|arriving late|exception|on hold)\b/i, 'Delayed'],
  [/\b(in transit|on the way|reached .*hub|arrived at|left .*facility|dispatched from|on its way)\b/i, 'In transit'],
  [/\b(shipped|dispatched|handed (over )?to courier)\b/i, 'Shipped'],
  [/\b(packed|ready to ship|ready for dispatch|shipping soon|preparing (for|to) (ship|dispatch))\b/i, 'Packed'],
  [/\b(ordered|order (placed|confirmed|received)|confirmed|processing|under process|not yet (shipped|dispatched)|arriving|expected by)\b/i, 'Ordered'],
];

export function normalizeStatus(raw: string | null | undefined): OrderStatus {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Unknown';
  for (const [re, s] of RULES) if (re.test(text)) return s;
  return 'Unknown';
}

export const isFinal = (s: OrderStatus) => FINAL_STATUSES.has(s);
