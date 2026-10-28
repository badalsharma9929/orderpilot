// Actions executed inside a jiomart.com tab. API actions call the same Fynd
// cart endpoints the site's own buttons call (verified 2026-10-09); DOM actions
// press the site's buttons. The background re-reads the cart after each one.

import { JIOMART as S } from './selectors';
import { parseCartJson, parseCouponState, productCounter } from './parsers';
import { clickStrategies, findBySelectors, findByText, safeClick, setInputValue, waitFor } from '@/core/actions';
import { textOf } from '../common';
import { runLadder } from '@/core/ladder';
import { apiHeaders } from '@/adapters/registry';

type Result = { ok: true; layer?: string; data?: any } | { ok: false; error: string; blocked?: string };

async function click(spec: Parameters<typeof clickStrategies>[0], op: string): Promise<Result> {
  const r = await runLadder({ site: 'jiomart', op, strategies: clickStrategies(spec) });
  if (r.ok) return { ok: true, layer: r.layer };
  return { ok: false, error: r.attempts.map((a) => `${a.layer}:${a.error}`).join(' | '), blocked: r.blocked };
}

function locationHeader(): Record<string, string> {
  try {
    const pin = localStorage.getItem('pin');
    return pin ? { 'x-location-detail': pin } : {};
  } catch {
    return {};
  }
}

async function api(method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: { ...apiHeaders('jiomart'), ...locationHeader(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : null;
  return { status: res.status, json };
}

async function readCartApi() {
  const pin = (() => { try { return JSON.parse(localStorage.getItem('pin') ?? 'null')?.pincode; } catch { return undefined; } })();
  const r = await api('GET', S.orders.api.cart(pin));
  if (r.status !== 200 || !r.json) throw new Error(`cart API HTTP ${r.status}`);
  return parseCartJson(r.json);
}

const gstApplied = (gstin: string) => textOf(document, S.gst.appliedNumber).replace(/\s/g, '').toUpperCase().includes(gstin.toUpperCase());

const plusButton = () => {
  const btns = Array.from(document.querySelectorAll(S.product.qtyBtn));
  return btns.find((b) => /\+|add|increase/i.test(b.textContent ?? '') || /increase|plus|add/i.test(b.getAttribute('aria-label') ?? '')) ?? btns[btns.length - 1] ?? null;
};
const minusButton = () => {
  const btns = Array.from(document.querySelectorAll(S.product.qtyBtn));
  return btns.find((b) => /−|-|decrease|remove/i.test(b.textContent ?? '') || /decrease|minus|remove/i.test(b.getAttribute('aria-label') ?? '')) ?? btns[0] ?? null;
};

export const jiomartActions: Record<string, (args: any) => Promise<Result>> = {
  /** Layer A: set an existing cart line's quantity with the cart API ("update_item", as the site does). */
  async apiSetCartQty({ productId, qty }: { productId: string; qty: number }) {
    const cart = await readCartApi();
    const item = cart.items.find((i) => i.productId === String(productId));
    if (!item) return { ok: false, error: 'item not in cart yet' };
    if (!cart.cartId) return { ok: false, error: 'no cart id' };
    const r = await api('PUT', S.orders.api.cartUpdate(cart.cartId), {
      operation: 'update_item',
      items: [{
        item_id: Number(item.productId), item_size: item.size, quantity: qty,
        article_id: item.articleId, item_index: item.index, identifiers: { identifier: item.identifier },
      }],
    });
    if (r.status === 429 || r.status === 503) return { ok: false, error: `pushback ${r.status}` };
    if (r.status >= 400) return { ok: false, error: `cart update HTTP ${r.status}: ${r.json?.message ?? ''}` };
    return { ok: true, layer: 'A', data: r.json?.message };
  },

  /** Layers B/C on the product page: press "Add", then + until the counter shows qty (stops at the site max). */
  async pdpSetQty({ qty }: { qty: number }) {
    if (!productCounter(document)) {
      const added = await click({
        selectors: S.product.addToCart, text: S.product.addToCartText,
        postCondition: () => productCounter(document) > 0, postTimeoutMs: 8000,
      }, 'addToCart');
      if (!added.ok) return added;
    }
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const cur = productCounter(document);
      if (cur === qty) return { ok: true, layer: 'B', data: cur };
      const btn = cur < qty ? plusButton() : minusButton();
      if (!btn || (btn as HTMLButtonElement).disabled) return { ok: true, layer: 'B', data: cur }; // site max reached
      safeClick(btn);
      await waitFor(() => productCounter(document) !== cur, 5000).catch(() => {});
      if (productCounter(document) === cur) return { ok: true, layer: 'B', data: cur }; // site refused more
    }
    return { ok: false, error: 'quantity counter did not reach the target' };
  },

  /** Layer C on the cart page: + / − on the matching line. */
  async cartSetQty({ title, qty }: { title: string; qty: number }) {
    const lines = Array.from(document.querySelectorAll(S.cart.item.join(', ')));
    const line = lines.find((l) => (l.textContent ?? '').toLowerCase().includes(title.toLowerCase().slice(0, 30)));
    if (!line) return { ok: false, error: 'cart line not found' };
    const qtyOf = () => Number((line.querySelector(S.cart.qty.join(', '))?.textContent ?? '').replace(/\D/g, '')) || 0;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const cur = qtyOf();
      if (cur === qty) return { ok: true, layer: 'C', data: cur };
      const btn = line.querySelector((cur < qty ? S.cart.plus : S.cart.minus).join(', '));
      if (!btn || (btn as HTMLButtonElement).disabled || btn.matches('.cart-item__quantityBtnPlusDisabled')) return { ok: true, layer: 'C', data: cur };
      safeClick(btn);
      await waitFor(() => qtyOf() !== cur, 5000).catch(() => {});
      if (qtyOf() === cur) return { ok: true, layer: 'C', data: cur };
    }
    return { ok: false, error: 'cart quantity did not reach the target' };
  },

  /** Is a GST invoice with this GSTIN already on the cart? */
  async gstState({ gstin }: { gstin: string }) {
    return { ok: true, data: { applied: gstApplied(gstin), shown: textOf(document, S.gst.appliedNumber) } };
  },

  /**
   * Layer B: tick "GST Invoice", type the GSTIN, submit (JioMart verifies it),
   * pick the first billing address if asked, confirm. None of these buttons pays.
   */
  async applyGst({ gstin }: { gstin: string }) {
    if (gstApplied(gstin)) return { ok: true, layer: 'B', data: { ok: true, message: 'GST invoice already on' } };
    const box = findBySelectors(S.gst.checkbox) as HTMLInputElement | null;
    if (!box) return { ok: false, error: 'GST Invoice option not found on this cart' };
    if (box.checked && textOf(document, S.gst.appliedNumber)) safeClick(box); // a different GSTIN is on: turn it off first
    await waitFor(() => !findBySelectors(S.gst.input), 1500).catch(() => {});
    if (!findBySelectors(S.gst.input)) safeClick(findBySelectors(S.gst.checkbox) ?? box);
    const input = (await waitFor(() => findBySelectors(S.gst.input), 6000).catch(() => null)) as HTMLInputElement | null;
    if (!input) return { ok: false, error: 'GSTIN form did not open' };
    setInputValue(input, gstin);
    const submit = findBySelectors(S.gst.submit) ?? findByText(S.gst.submitText);
    if (!submit) return { ok: false, error: 'GSTIN submit button not found' };
    safeClick(submit);
    const step = await waitFor(() => {
      const err = textOf(document, S.gst.error);
      if (err) return { kind: 'error' as const, text: err };
      if (S.gst.panText.test(document.body.innerText ?? '')) return { kind: 'pan' as const, text: 'JioMart asks for PAN details for this order value' };
      if (gstApplied(gstin)) return { kind: 'done' as const, text: '' };
      const confirm = findByText(S.gst.confirmText);
      return confirm ? { kind: 'confirm' as const, text: '', el: confirm } : null;
    }, 15000).catch(() => null);
    if (!step) return { ok: false, error: 'GSTIN verification did not answer' };
    if (step.kind === 'error' || step.kind === 'pan') return { ok: true, layer: 'B', data: { ok: false, message: step.text } };
    if (step.kind === 'confirm') {
      const radios = Array.from(document.querySelectorAll<HTMLInputElement>(S.gst.addressRadio.join(', ')));
      if (radios.length && !radios.some((r) => r.checked)) safeClick(radios[0]);
      safeClick(step.el);
    }
    await waitFor(() => gstApplied(gstin), 10000).catch(() => {});
    const ok = gstApplied(gstin);
    return { ok: true, layer: 'B', data: { ok, message: ok ? `GST invoice on: ${textOf(document, S.gst.appliedName) || gstin}` : 'GST form did not confirm' } };
  },

  /** Layer A: apply a coupon with the cart API (what the site's Apply button calls). */
  async apiApplyCoupon({ code }: { code: string }) {
    const cart = await readCartApi();
    if (!cart.cartId) return { ok: false, error: 'no cart id' };
    const r = await api('POST', S.orders.api.coupon(cart.cartId), { coupon_code: code });
    if (r.status === 429 || r.status === 503) return { ok: false, error: `pushback ${r.status}` };
    const after = await readCartApi().catch(() => null);
    const msg = r.json?.message ?? r.json?.breakup_values?.coupon?.message ?? after?.couponMessage ?? '';
    if (r.status >= 400) return { ok: true, layer: 'A', data: { ok: false, message: msg || `HTTP ${r.status}` } }; // a definite "no" from the site
    return { ok: true, layer: 'A', data: { ok: !!after?.couponApplied, message: msg, discount: after?.discount, payable: after?.payable } };
  },

  /** Layer B: open the coupon drawer, type the code, press Apply, read the site's verdict. */
  async domApplyCoupon({ code }: { code: string }) {
    const input = () => findBySelectors(S.coupon.input) as HTMLInputElement | null;
    if (!input()) {
      const opened = await click({ selectors: S.coupon.open, text: S.coupon.openText, postCondition: () => !!input(), findTimeoutMs: 3000 }, 'openCoupons');
      if (!opened.ok) return opened;
    }
    const el = await waitFor(input, 4000).catch(() => null);
    if (!el) return { ok: false, error: 'coupon field not found' };
    setInputValue(el, code);
    const root = el.closest('[class*="coupons__"]') ?? document;
    const btn = findBySelectors(S.coupon.apply, root) ?? findByText(S.coupon.applyText, root);
    if (!btn) return { ok: false, error: 'Apply button not found' };
    safeClick(btn);
    const state = await waitFor(() => { const s = parseCouponState(document); return s.ok !== null ? s : null; }, 10000).catch(() => parseCouponState(document));
    return { ok: true, layer: 'B', data: state };
  },
};
