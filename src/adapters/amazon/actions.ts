// Actions executed inside an amazon.in tab. Each returns quickly; the
// background verifies the real effect (cart contents, coupon result) with a
// fresh read, so a click that "succeeded" without effect is still caught.

import { AMAZON as S } from './selectors';
import { clickStrategies, findBySelectors, findByText, safeClick, setInputValue, waitFor } from '@/core/actions';
import { runLadder } from '@/core/ladder';
import { parseCart, parseCheckout } from './parsers';

type Result = { ok: true; layer?: string; data?: any } | { ok: false; error: string; blocked?: string };

async function click(spec: Parameters<typeof clickStrategies>[0], op: string): Promise<Result> {
  const r = await runLadder({ site: 'amazon', op, strategies: clickStrategies(spec) });
  if (r.ok) return { ok: true, layer: r.layer };
  return { ok: false, error: r.attempts.map((a) => `${a.layer}:${a.error}`).join(' | '), blocked: r.blocked };
}

export const amazonActions: Record<string, (args: any) => Promise<Result>> = {
  /** Layer A add: submit the product page's own add-to-cart form over fetch (same origin, CSRF token included). */
  async addViaForm({ qty }: { qty: number }) {
    const form = findBySelectors(S.product.addToCartForm) as HTMLFormElement | null;
    if (!form) return { ok: false, error: 'no add-to-cart form' };
    const fd = new FormData(form);
    fd.set('quantity', String(qty));
    fd.set('items[0.base][quantity]', String(qty));
    if (!fd.has('submit.add-to-cart')) fd.set('submit.add-to-cart', 'Add to Cart');
    const res = await fetch(form.action, { method: 'POST', body: fd, credentials: 'include', redirect: 'follow' });
    if (res.status === 429 || res.status === 503) return { ok: false, error: `pushback ${res.status}` };
    return res.ok ? { ok: true, layer: 'A' } : { ok: false, error: `HTTP ${res.status}` };
  },

  /** On /gp/aws/cart/add.html Amazon asks to confirm; this presses that confirm control. */
  async confirmAwsAdd() {
    return click({ selectors: ['input[name="add"]', 'input[type="submit"][name*="add"]', '#a-autoid-0 input'], text: [/^continue$/i, /add to (cart|basket)/i] }, 'awsAddConfirm');
  },

  /** Layers B/C add: set the quantity dropdown then press Add to Cart. */
  async addViaButton({ qty }: { qty: number }) {
    const sel = findBySelectors(S.product.qtySelect) as HTMLSelectElement | null;
    if (sel && qty > 1) {
      const has = Array.from(sel.options).some((o) => o.value === String(qty));
      if (has) setInputValue(sel, String(qty));
    }
    return click({ selectors: S.product.addToCartButton, text: S.product.addToCartText }, 'addToCart');
  },

  async tickProductCoupon() {
    const box = findBySelectors(S.product.couponCheckbox) as HTMLInputElement | null;
    if (box?.checked) return { ok: true, layer: 'B', data: 'already' };
    return click({ selectors: S.product.couponCheckbox, text: S.product.couponText, findTimeoutMs: 800 }, 'productCoupon');
  },

  /** Sets one cart line's quantity (dropdown, text box + Update, or +/− stepper). */
  async setCartQty({ asin, qty }: { asin: string; qty: number }) {
    const line = document.querySelector(`.sc-list-item[data-asin="${asin}"], [data-asin="${asin}"][data-itemtype="active"]`);
    if (!line) return { ok: false, error: `cart line ${asin} not found` };
    const done = () => parseCart(document).lines.find((l) => l.asin === asin)?.qty === qty;

    const select = line.querySelector<HTMLSelectElement>('select[name="quantity"]');
    if (select && Array.from(select.options).some((o) => o.value === String(qty))) {
      setInputValue(select, String(qty));
      try { await waitFor(done, 6000); return { ok: true, layer: 'B' }; } catch {}
    }
    if (select) {
      // "10+" option switches the line to a free-text box.
      const plus = Array.from(select.options).find((o) => /\+/.test(o.textContent ?? ''));
      if (plus) setInputValue(select, plus.value);
    }
    const box = await waitFor(() => line.querySelector<HTMLInputElement>('input[name="quantityBox"], input.sc-quantity-textfield'), 2000).catch(() => null);
    if (box) {
      setInputValue(box, String(qty));
      const upd = findByText(S.cart.updateText, line) ?? line.querySelector('a[data-action="update"], .sc-update-link a, input[value="Update"]');
      if (upd) safeClick(upd);
      try { await waitFor(done, 6000); return { ok: true, layer: 'B' }; } catch {}
    }
    // Stepper: press + or − until the count matches (bounded, so it stops before the next layer starts).
    const deadline = Date.now() + 25000;
    for (let i = 0; i < 60 && Date.now() < deadline; i++) {
      const current = parseCart(document).lines.find((l) => l.asin === asin)?.qty ?? 0;
      if (current === qty) return { ok: true, layer: 'C' };
      const btn = current < qty
        ? line.querySelector('[data-a-selector="increment"], button[aria-label*="Increase" i], .a-icon-plus')?.closest('button, span[role=button], a') ?? null
        : line.querySelector('[data-a-selector="decrement"], button[aria-label*="Decrease" i], .a-icon-minus')?.closest('button, span[role=button], a') ?? null;
      if (!btn) break;
      safeClick(btn);
      await waitFor(() => (parseCart(document).lines.find((l) => l.asin === asin)?.qty ?? 0) !== current, 4000).catch(() => {});
    }
    return done() ? { ok: true, layer: 'C' } : { ok: false, error: 'could not set cart quantity' };
  },

  async proceedToCheckout() {
    return click({ selectors: S.cart.proceed, text: S.cart.proceedText }, 'proceedToCheckout');
  },

  /** Opens the promo field if collapsed, types the code, presses Apply, waits for Amazon's verdict. */
  async applyCoupon({ code }: { code: string }) {
    const input = () => findBySelectors(S.checkout.codeInput) as HTMLInputElement | null;
    if (!input()) {
      const opened = await click({ selectors: S.checkout.showCodeLink, text: S.checkout.showCodeText, postCondition: () => !!input(), findTimeoutMs: 2500 }, 'openCodeField');
      if (!opened.ok) return opened;
    }
    const el = await waitFor(input, 4000).catch(() => null);
    if (!el) return { ok: false, error: 'promo code field not found' };
    setInputValue(el, code);
    const before = parseCheckout(document).couponMessage;
    const applied = await click({
      selectors: S.checkout.applyButton,
      text: S.checkout.applyText,
      postCondition: () => { const c = parseCheckout(document); return c.couponOk !== null && c.couponMessage !== before; },
      postTimeoutMs: 10000,
    }, 'applyCoupon');
    const state = parseCheckout(document);
    return applied.ok ? { ok: true, layer: applied.layer, data: state } : { ...applied, ...(state.couponOk === false ? { error: state.couponMessage } : {}) };
  },
};
