export type QtyPlan =
  | { qty: number; subtotal: number; shortfall: number; clamped: boolean }
  | { qty: null; reason: 'no-price' | 'out-of-stock' | 'bad-target' };

/**
 * How the quantity is chosen (Settings → Rules):
 *  - reach:   smallest qty whose subtotal is at least the target (default; meets coupon minimums)
 *  - closest: whichever of the two neighbours lands nearer the target
 *  - under:   largest qty that does not go past the target (at least 1)
 */
export type QtyRule = 'reach' | 'closest' | 'under';

export function qtyForTarget(unitPrice: number | null, target: number, maxQty = 999, inStock = true, rule: QtyRule = 'reach'): QtyPlan {
  if (!inStock) return { qty: null, reason: 'out-of-stock' };
  if (unitPrice == null || !(unitPrice > 0)) return { qty: null, reason: 'no-price' };
  if (!(target > 0)) return { qty: null, reason: 'bad-target' };
  // Work in paise so 3 × 33.33 doesn't miss a ₹99.99 target by a float hair.
  const p = Math.round(unitPrice * 100);
  const t = Math.round(target * 100);
  const up = Math.max(1, Math.ceil(t / p));
  const down = Math.max(1, Math.floor(t / p));
  const needed = rule === 'reach' ? up : rule === 'under' ? down : (Math.abs(up * p - t) < Math.abs(down * p - t) ? up : down);
  const cap = Math.max(1, Math.floor(maxQty));
  const qty = Math.min(needed, cap);
  const subtotal = (qty * p) / 100;
  return { qty, subtotal, shortfall: Math.max(0, (t - qty * p) / 100), clamped: needed > cap };
}

/** Parses "₹1,23,456.50", "Rs. 999", "1,299" → number; null when no digits. */
export function parseInr(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.replace(/[,\s]/g, '').match(/(\d+(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : null;
}
