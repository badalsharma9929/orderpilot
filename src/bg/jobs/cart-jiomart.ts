// Cart Builder for JioMart. Coupons apply in the cart (/cart/bag), so the flow
// ends there with the coupon applied; you press the pay button yourself.

import { BlockedError } from '@/core/ladder';
import { qtyForTarget } from '@/core/qty';
import type { CartInput } from '@/core/messaging';
import { JIOMART } from '@/adapters/jiomart/selectors';
import type { CouponState, JioApiCart, JioCart, JioProduct } from '@/adapters/jiomart/parsers';
import { db, type CartRunRow } from '@/db/dexie';
import { accountId } from '@/db/repo';
import { claudeExtract } from '@/llm/claude';
import { notify } from '../progress';
import { getSettings } from '@/core/settings';
import { navigate } from '../tabs';
import { read } from '../read';
import {
  AlreadyDone, banner, checkCancel, claudeClick, ensureUrl, ladder, lastLayer, liveParse, mustAct,
  productTab, tabFetch, tabText, verify, type Log,
} from './cart-common';

type Cart = JioCart & Partial<JioApiCart>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runJiomartCart(input: CartInput, run: CartRunRow, log: Log) {
  const t0 = Date.now();
  const origin = new URL(input.url).origin;
  const m = input.url.match(JIOMART.productUrlRe);
  if (!m) throw new Error('Use a JioMart product link (https://www.jiomart.com/product/…)');
  const tabId = await productTab(input.url, (a) => !!a && a.includes(m[1]));
  const cartUrl = `${origin}${JIOMART.cart.path}`;
  const productUrl = input.url;
  log('Opened product page', true);

  // 1. Who is signed in (session API first, page data second).
  let acct: { name: string };
  try {
    acct = await ladder<{ name: string }>('account', [
      { layer: 'A', name: 'session-api', timeoutMs: 20000, run: () => tabFetch(tabId, `${origin}${JIOMART.orders.api.session}`, 'jiomart.api.session') },
      { layer: 'B', name: 'page', timeoutMs: 20000, run: () => liveParse(tabId, 'jiomart.account') },
    ], (v) => (v?.name ? [] : ['account']));
  } catch (e) {
    if (e instanceof BlockedError) throw e;
    throw new BlockedError('login', 'Sign in to JioMart in this tab, then run again');
  }
  run.accountId = accountId('jiomart', acct.name);
  await db.accounts.put({ id: run.accountId, platform: 'jiomart', displayName: acct.name, lastSeenAt: run.at });
  log(`Signed in as ${acct.name}`, true, { layer: lastLayer });

  // 2. Product: the price renders after the page picks your pincode, so wait for it.
  const product = await ladder<JioProduct>('product', [
    {
      layer: 'A', name: 'live-page', timeoutMs: 14000,
      run: async () => {
        const end = Date.now() + 12000;
        for (;;) {
          const p = await liveParse<JioProduct>(tabId, 'jiomart.product');
          if (p.unitPrice || (p.title && !p.inStock) || Date.now() > end) return p;
          await sleep(600);
        }
      },
    },
    { layer: 'D', name: 'claude', timeoutMs: 45000, run: async () => ({ ...((await claudeExtract('product', await tabText(tabId))) as any), productId: m[2], slug: m[1] }) },
  ], (p) => (!p.productId ? ['productId'] : p.inStock && p.unitPrice == null ? ['unitPrice'] : []));
  if (!product.inStock) throw new Error('Product is out of stock at your pincode');
  const cfg = await getSettings();
  if (cfg.maxQtyCap > 0 && cfg.maxQtyCap < product.maxQty) product.maxQty = cfg.maxQtyCap; // your own cap (Settings → Rules)
  // A limit JioMart enforced on an earlier run for this product (it is not always shown on the page).
  const limitKey = `maxQty:jiomart:${product.productId}`;
  const learned = Number((await chrome.storage.local.get(limitKey))[limitKey]) || 0;
  if (learned > 0 && learned < product.maxQty) product.maxQty = learned;
  run.unitPrice = product.unitPrice ?? undefined;
  log(`Product ₹${product.unitPrice} · max ${product.maxQty === 999 ? '—' : product.maxQty} per order · ${product.title.slice(0, 45)}`, true, { layer: lastLayer });
  checkCancel();

  // 3. Quantity against the whole cart (other items count toward the coupon minimum).
  const cart0 = await readCart(tabId, origin);
  const line0 = findLine(cart0, product);
  const existing = line0?.qty ?? 0;
  useCartPrice(line0?.unitPrice);
  const others = Math.max(0, (cart0.subtotal ?? 0) - existing * (product.unitPrice ?? 0));
  let qty: number;
  if (input.qty) qty = Math.min(input.qty, product.maxQty);
  else {
    const plan = qtyForTarget(product.unitPrice, Math.max(0.01, input.target - others), product.maxQty, product.inStock, cfg.qtyRule);
    if (plan.qty == null) throw new Error(`Cannot plan quantity: ${plan.reason}`);
    qty = plan.qty;
    if (plan.clamped) log(`JioMart allows max ${product.maxQty} per order; cart will be ₹${plan.shortfall} short of the target`, false);
  }
  log(`Quantity ${qty}${others ? ` (other cart items ₹${others})` : ''}`, true);

  /** JioMart's cart price is the truth; the page can show offer/EMI prices too. */
  function useCartPrice(cartUnit: number | null | undefined): boolean {
    if (!cartUnit || !product.unitPrice || Math.abs(cartUnit - product.unitPrice) / cartUnit <= 0.02) return false;
    log(`Page showed ₹${product.unitPrice}, JioMart's cart says ₹${cartUnit} each — using the cart price`, false);
    product.unitPrice = cartUnit;
    run.unitPrice = cartUnit;
    return true;
  }
  const plan = (others2: number) => {
    const p = qtyForTarget(product.unitPrice, Math.max(0.01, input.target - others2), product.maxQty, product.inStock, cfg.qtyRule);
    return p.qty ?? qty;
  };

  // 4. Put exactly qty in the cart: A cart API → B product +/− → C cart +/− → D Claude → E you.
  let achieved = 0;
  const lineQty = async () => findLine(await readCart(tabId, origin), product)?.qty ?? 0;
  const setQty = (want: number) => ladder<true>('setQty', [
    {
      layer: 'A', name: 'cart-api', timeoutMs: 15000,
      run: async () => {
        if (!findLine(await readCart(tabId, origin), product)) throw new Error('item not in cart yet');
        await mustAct(tabId, 'apiSetCartQty', { productId: product.productId, qty: want });
        await verify(async () => (achieved = await lineQty()) === want);
        return true;
      },
    },
    {
      layer: 'B', name: 'product-buttons', timeoutMs: 45000,
      run: async () => {
        await ensureUrl(tabId, productUrl, (c) => c.includes(m[1]));
        const r = await mustAct(tabId, 'pdpSetQty', { qty: want });
        const shown = Number(r.ok && r.data) || 0;
        // The site may stop below want (its own per-order limit): accept what it shows, once the cart agrees.
        await verify(async () => { achieved = await lineQty(); return achieved > 0 && (achieved === want || achieved === shown); }, 8000);
        return true;
      },
    },
    {
      layer: 'C', name: 'cart-buttons', timeoutMs: 45000,
      run: async () => {
        if (!findLine(await readCart(tabId, origin), product)) throw new AlreadyDone(); // nothing to adjust on the cart page
        await ensureUrl(tabId, cartUrl);
        await mustAct(tabId, 'cartSetQty', { title: product.title, qty: want });
        await verify(async () => (achieved = await lineQty()) > 0, 8000);
        return true;
      },
    },
    {
      layer: 'D', name: 'claude-click', timeoutMs: 45000,
      run: async () => {
        await ensureUrl(tabId, productUrl, (c) => c.includes(m[1]));
        await claudeClick(tabId, 'Add this product to the cart (the "Add" button)');
        await verify(async () => (achieved = await lineQty()) > 0, 8000);
        return true;
      },
    },
    {
      layer: 'E', name: 'ask-you', timeoutMs: 125000,
      run: async () => {
        await ensureUrl(tabId, cartUrl);
        await banner(tabId, `Please set this item's quantity to ${want} — I will continue automatically.`);
        await verify(async () => (achieved = await lineQty()) === want, 120000);
        return true;
      },
    },
  ]);

  if (existing !== qty) {
    await setQty(qty).catch(async (e) => { if (!(e instanceof AlreadyDone)) throw e; });
    // Now the item is in the cart: check the page price against JioMart's own cart price.
    const afterAdd = await readCart(tabId, origin);
    const line = findLine(afterAdd, product);
    if (useCartPrice(line?.unitPrice) && !input.qty) {
      const othersNow = Math.max(0, (afterAdd.subtotal ?? 0) - (line?.qty ?? 0) * (product.unitPrice ?? 0));
      qty = plan(othersNow);
      log(`Quantity re-planned to ${qty} at the cart price`, true);
    }
    // An add through the product page can land at 1; finish the exact count with the cart API.
    if (achieved && achieved !== qty && achieved < product.maxQty) await setQty(qty).catch(() => {});
    if (achieved && achieved < qty) {
      // JioMart refused more: remember its per-order limit for this product.
      product.maxQty = achieved;
      await chrome.storage.local.set({ [limitKey]: achieved });
      log(`JioMart allows only ${achieved} of this item per order (you asked for ${qty}). For more, place another order after paying for this one.`, false, { layer: lastLayer });
      qty = achieved;
    } else {
      log(`Cart quantity ${achieved || qty}`, true, { layer: lastLayer });
      if (achieved) qty = achieved;
    }
  }
  checkCancel();

  // 5. Target check: raise by up to 2 if the price moved (never past the site max).
  let cart = await readCart(tabId, origin);
  for (let raises = 0; !input.qty && cart.subtotal != null && cart.subtotal < input.target && cfg.qtyRule === 'reach' && raises < cfg.raiseAttempts && qty + 1 <= product.maxQty; raises++) {
    qty += 1;
    log(`Subtotal ₹${cart.subtotal} below ₹${input.target}; raising to ${qty}`, true);
    await setQty(qty).catch(() => {});
    cart = await readCart(tabId, origin);
  }
  run.qty = findLine(cart, product)?.qty ?? qty;
  run.subtotal = cart.subtotal ?? undefined;
  const meets = cart.subtotal == null ? null : cart.subtotal >= input.target;
  log(`Cart subtotal ₹${cart.subtotal ?? '?'}${meets === false ? ` — below target ₹${input.target}` : ''}`, meets !== false);
  checkCancel();

  // 6. Coupon in the cart: A coupon API → B coupon drawer → E you.
  await navigate(tabId, cartUrl);
  if (input.coupon) {
    const code = input.coupon.trim().toUpperCase();
    const verdict = await ladder<CouponState & { discount?: number | null; payable?: number | null }>('coupon', [
      {
        layer: 'A', name: 'coupon-api', timeoutMs: 15000,
        run: async () => {
          const r = await mustAct(tabId, 'apiApplyCoupon', { code });
          await navigate(tabId, cartUrl); // show the applied coupon on screen
          return r.ok ? r.data : null;
        },
      },
      { layer: 'B', name: 'coupon-drawer', timeoutMs: 25000, run: async () => { const r = await mustAct(tabId, 'domApplyCoupon', { code }); return r.ok ? r.data : null; } },
      {
        layer: 'E', name: 'ask-you', timeoutMs: 125000,
        run: async () => {
          await banner(tabId, `Please apply coupon ${code} — I will read the result automatically.`);
          const end = Date.now() + 120000;
          for (;;) {
            const s = await liveParse<CouponState>(tabId, 'jiomart.coupon').catch(() => ({ ok: null, message: '' }) as CouponState);
            if (s.ok !== null || Date.now() > end) return s;
            await sleep(1500);
          }
        },
      },
    ], (v) => (v && v.ok !== null && v.ok !== undefined ? [] : ['coupon verdict']));
    cart = await readCart(tabId, origin);
    run.couponOk = !!verdict.ok || !!cart.couponApplied;
    run.discount = cart.discount ?? verdict.discount ?? undefined;
    run.payable = cart.payable ?? verdict.payable ?? undefined;
    const min = cart.couponMinimum ? ` · needs ₹${cart.couponMinimum}` : '';
    log(`Coupon ${code}: ${run.couponOk ? `applied, −₹${run.discount ?? '?'}` : 'not accepted'}${verdict.message ? ` — ${verdict.message}` : ''}${!run.couponOk ? min : ''}`, run.couponOk, { layer: lastLayer });
  }

  // 7. GST invoice (Settings → Rules → GSTIN): B the cart's own form → E you.
  if (cfg.gstin) {
    const gstin = cfg.gstin.trim().toUpperCase();
    type Gst = { ok: boolean; message: string };
    const gst = await ladder<Gst>('gst', [
      { layer: 'B', name: 'gst-form', timeoutMs: 40000, run: async () => { const r = await mustAct(tabId, 'applyGst', { gstin }); return (r.ok ? r.data : null) as Gst; } },
      {
        layer: 'E', name: 'ask-you', timeoutMs: 125000,
        run: async () => {
          await banner(tabId, `Please tick "GST Invoice" and enter GSTIN ${gstin} — I will continue automatically.`);
          const end = Date.now() + 120000;
          for (;;) {
            const r = await mustAct(tabId, 'gstState', { gstin }).catch(() => null);
            if (r?.ok && r.data?.applied) return { ok: true, message: 'GST invoice on' };
            if (Date.now() > end) return { ok: false, message: 'GST invoice not set' };
            await sleep(1500);
          }
        },
      },
    ], (v) => (v && typeof v.ok === 'boolean' ? [] : ['gst verdict']));
    log(gst.ok ? gst.message : `GST invoice not applied — ${gst.message}`, gst.ok, { layer: lastLayer });
  }

  await banner(tabId, input.coupon
    ? (run.couponOk ? `Coupon applied (−₹${run.discount ?? '?'}), to pay ₹${run.payable ?? '?'}. Review and pay yourself.` : 'Coupon not accepted — see the message, then pay yourself.')
    : `Cart ready: ${run.qty} × item, subtotal ₹${run.subtotal ?? '?'}. Pay yourself when ready.`);
  run.outcome = 'ready-to-pay';
  const tab = await chrome.tabs.update(tabId, { active: true });
  if (tab?.windowId) await chrome.windows.update(tab.windowId, { focused: true });
  log(`Ready to pay · ${((Date.now() - t0) / 1000).toFixed(1)}s`, true);
  notify('JioMart cart ready', `${run.qty} units · subtotal ₹${run.subtotal ?? '?'}${input.coupon ? ` · coupon ${run.couponOk ? 'applied' : 'not applied'}` : ''}`);
}

function findLine(cart: Cart, p: JioProduct) {
  return cart.lines.find((l) => l.productId && l.productId === p.productId)
    ?? cart.lines.find((l) => !l.productId && l.title && p.title && l.title.toLowerCase().slice(0, 30) === p.title.toLowerCase().slice(0, 30));
}

/** Cart read ladder: A cart API from the site tab → B cart API from the worker → C rendered cart page (→ D Claude). */
async function readCart(tabId: number, origin: string): Promise<Cart> {
  return ladder<Cart>('cart.read', [
    { layer: 'A', name: 'cart-api-tab', timeoutMs: 10000, run: () => tabFetch<Cart>(tabId, `${origin}${JIOMART.orders.api.cart()}`, 'jiomart.api.cart') },
    { layer: 'B', name: 'cart-api', timeoutMs: 10000, run: async () => { const r = await read(`${origin}${JIOMART.orders.api.cart()}`, 'jiomart.api.cart', { noPool: true }); if (!r.ok) throw new Error('cart API failed'); return r.value as Cart; } },
    { layer: 'C', name: 'cart-page', timeoutMs: 45000, run: async () => { const r = await read(`${origin}${JIOMART.cart.path}`, 'jiomart.cart', { noPool: true, claude: 'cart', op: 'jiomart.cart.page' }); if (!r.ok) throw new Error('cart page unreadable'); return r.value as Cart; } },
  ], (c) => (Array.isArray(c?.lines) ? [] : ['lines']));
}
