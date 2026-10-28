// Cart Builder (Amazon). Every step is a ladder; every add/quantity step is
// verified by re-reading the real cart. Stops on the payment page: never pays.

import { BlockedError } from '@/core/ladder';
import { qtyForTarget } from '@/core/qty';
import type { CartInput } from '@/core/messaging';
import { platformOfUrl } from '@/adapters/registry';
import { AMAZON } from '@/adapters/amazon/selectors';
import type { AmazonCart, AmazonProduct, CheckoutState } from '@/adapters/amazon/parsers';
import { db, type CartRunRow } from '@/db/dexie';
import { accountId } from '@/db/repo';
import { claudeExtract } from '@/llm/claude';
import { emit, notify } from '../progress';
import { getSettings } from '@/core/settings';
import { closeWorkerWindow, navigate, waitForComplete } from '../tabs';
import { read } from '../read';
import {
  AlreadyDone as AlreadyAdded, action, banner, checkCancel, claudeClick, ladder, lastLayer, liveParse, mustAct,
  productTab, startCart, tabText, unwrapRead, verify, type Log, type Step,
} from './cart-common';
import { runJiomartCart } from './cart-jiomart';

export { cancelCart } from './cart-common';

export async function runCart(input: CartInput): Promise<CartRunRow> {
  const platform = platformOfUrl(input.url);
  startCart(platform ?? 'amazon');
  const steps: Step[] = [];
  const t0 = Date.now();
  const log: Log = (step, ok, extra = {}) => {
    steps.push({ step, ok, ...extra });
    emit('cart', step, { ok, layer: extra.layer, note: extra.note });
  };
  const run: CartRunRow = { at: new Date().toISOString(), platform: platform ?? 'amazon', url: input.url, coupon: input.coupon, target: input.target, outcome: 'failed', steps };

  try {
    if (!platform || platform === 'flipkart') throw new Error(platform ? 'Flipkart support arrives in a later milestone' : 'Not an Amazon.in / Flipkart / JioMart link');
    const origin = new URL(input.url).origin;
    await chrome.storage.local.set({ [`origin:${platform}`]: origin });
    if (platform === 'jiomart') {
      await runJiomartCart(input, run, log);
    } else {
      await runAmazonCart(input, run, log, origin, t0);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    run.outcome = e instanceof BlockedError ? (e.reason === 'login' || e.reason === 'captcha' ? 'needs-you' : 'blocked') : 'failed';
    log(msg, false);
  } finally {
    await closeWorkerWindow();
    emit('cart', 'done', { done: true, ok: run.outcome === 'ready-to-pay' });
    await db.cartRuns.add(run);
  }
  return run;
}

async function runAmazonCart(input: CartInput, run: CartRunRow, log: Log, origin: string, t0: number) {
  {
    const tabId = await productTab(input.url, (a) => sameProduct(a, input.url));
    log('Opened product page', true);

    // 1. Account + product (live tab first: it is already loaded).
    const acct = await liveParse<{ name: string } | null>(tabId, 'amazon.account');
    if (!acct) throw new BlockedError('login', 'Sign in to Amazon in this tab, then run again');
    run.accountId = accountId('amazon', acct.name);
    await db.accounts.put({ id: run.accountId, platform: 'amazon', displayName: acct.name, lastSeenAt: run.at });
    log(`Signed in as ${acct.name}`, true);

    const product = await ladder<AmazonProduct>('product', [
      { layer: 'A', name: 'live-tab', run: () => liveParse(tabId!, 'amazon.product') },
      { layer: 'B', name: 'offscreen-fetch', run: async () => unwrapRead(await read(input.url, 'amazon.product', { noPool: true })) },
      { layer: 'D', name: 'claude', timeoutMs: 45000, run: async () => ({ ...(await claudeExtract('product', await tabText(tabId!))) as AmazonProduct, asin: input.url.match(AMAZON.asinFromUrl)?.[1] ?? '' }) },
    ], (p) => (!p.asin ? ['asin'] : p.unitPrice == null && p.inStock ? ['unitPrice'] : []));
    if (!product.inStock) throw new Error('Product is out of stock');
    const cfg = await getSettings();
    if (cfg.maxQtyCap > 0 && cfg.maxQtyCap < product.maxQty) product.maxQty = cfg.maxQtyCap; // your own cap (Settings → Rules)
    run.unitPrice = product.unitPrice ?? undefined;
    log(`Product ₹${product.unitPrice} · ${product.title.slice(0, 50)}`, true);

    if (product.hasCoupon) {
      const r = await action(tabId, 'tickProductCoupon');
      log('Product coupon clipped', r.ok, { layer: r.ok ? r.layer : undefined, note: r.ok ? undefined : r.error });
    }
    checkCancel();

    // 2. Quantity against the whole cart: other items already count toward the coupon minimum.
    const cart0 = await readCart(origin);
    const existing = cart0.lines.find((l) => l.asin === product.asin)?.qty ?? 0;
    const others = Math.max(0, (cart0.subtotal ?? 0) - existing * (product.unitPrice ?? 0));
    let qty: number;
    if (input.qty) qty = input.qty;
    else {
      const need = Math.max(0.01, input.target - others);
      const plan = qtyForTarget(product.unitPrice, need, product.maxQty, product.inStock, cfg.qtyRule);
      if (plan.qty == null) throw new Error(`Cannot plan quantity: ${plan.reason}`);
      qty = plan.qty;
      if (plan.clamped) log(`Max ${product.maxQty} per order; short by ₹${plan.shortfall}`, false);
    }
    log(`Quantity ${qty}${others ? ` (other cart items ₹${others})` : ''}`, true);

    // 3. Add to cart (A form POST → A cart-add URL → B/C button → D Claude → E you).
    if (existing < qty) {
      const inCart = async () => (await readCart(origin)).lines.find((l) => l.asin === product.asin)?.qty ?? 0;
      const has = async () => (await inCart()) > existing;
      // Each layer re-reads the cart first: if a slower earlier layer did add
      // the item after all, the next layer must not add it a second time.
      const missing = async () => { const cur = await inCart(); if (cur > existing) throw new AlreadyAdded(); return qty - cur; };
      const guard = <T>(fn: () => Promise<T>) => async () => { try { return await fn(); } catch (e) { if (e instanceof AlreadyAdded) return true as T; throw e; } };
      await ladder<true>('addToCart', [
        { layer: 'A', name: 'form-post', timeoutMs: 15000, run: guard(async () => { const d = await missing(); await mustAct(tabId!, 'addViaForm', { qty: d }); return verify(has); }) },
        {
          layer: 'A', name: 'cart-add-url', timeoutMs: 20000,
          run: guard(async () => {
            const d = await missing();
            await navigate(tabId!, `${origin}/gp/aws/cart/add.html?ASIN.1=${product.asin}&Quantity.1=${d}`);
            await action(tabId!, 'confirmAwsAdd');
            return verify(has);
          }),
        },
        {
          layer: 'B', name: 'button', timeoutMs: 20000,
          run: guard(async () => { const d = await missing(); await ensureOn(tabId!, input.url); await mustAct(tabId!, 'addViaButton', { qty: d }); return verify(has); }),
        },
        { layer: 'D', name: 'claude-click', timeoutMs: 45000, run: guard(async () => { await missing(); await ensureOn(tabId!, input.url); await claudeClick(tabId!, 'Add this product to the shopping cart'); return verify(has); }) },
        { layer: 'E', name: 'ask-you', timeoutMs: 125000, run: guard(async () => { await missing(); await ensureOn(tabId!, input.url); await banner(tabId!, 'Please click "Add to Cart" — I will continue automatically.'); return verify(has, 120000); }) },
      ]);
      log('Added to cart', true, { layer: lastLayer });
    }
    checkCancel();

    // 4. Exact quantity + target check (raise by up to 2 if price moved).
    let cart = await readCart(origin);
    for (let raises = 0; ; raises++) {
      const line = cart.lines.find((l) => l.asin === product.asin);
      if (line?.qty !== qty) {
        cart = await setQty(tabId, origin, product.asin, qty);
        log(`Cart quantity set to ${qty}`, true, { layer: lastLayer });
      }
      if (input.qty || cfg.qtyRule !== 'reach' || cart.subtotal == null || cart.subtotal >= input.target) break;
      if (raises >= cfg.raiseAttempts || qty + 1 > product.maxQty) break; // report the shortfall below instead of looping
      qty += 1;
      log(`Subtotal ₹${cart.subtotal} below ₹${input.target}; raising to ${qty}`, true);
    }
    run.qty = qty;
    run.subtotal = cart.subtotal ?? undefined;
    const meets = cart.subtotal == null ? null : cart.subtotal >= input.target;
    log(`Cart subtotal ₹${cart.subtotal ?? '?'}${meets === false ? ` — below target ₹${input.target}` : ''}`, meets !== false);
    checkCancel();

    // 5. Coupon at the payment step, then stop.
    if (input.coupon) {
      const checkout = await couponFlow(tabId, origin, input.coupon, log);
      run.couponOk = checkout.couponOk ?? false;
      run.discount = checkout.discount ?? undefined;
      run.payable = checkout.orderTotal ?? undefined;
      await banner(tabId, run.couponOk ? `Coupon applied (−₹${run.discount ?? '?'}). Review and pay yourself.` : 'Coupon not accepted — check the message, then pay yourself.');
    } else {
      await ensureOn(tabId, `${origin}${AMAZON.cart.url}`);
      await banner(tabId, `Cart ready: ${qty} × item, subtotal ₹${cart.subtotal ?? '?'}. Proceed and pay yourself.`);
    }
    run.outcome = 'ready-to-pay';
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab?.windowId) await chrome.windows.update(tab.windowId, { focused: true });
    log(`Ready to pay · ${((Date.now() - t0) / 1000).toFixed(1)}s`, true);
    notify('Cart ready', `${qty} units · subtotal ₹${run.subtotal ?? '?'}${input.coupon ? ` · coupon ${run.couponOk ? 'applied' : 'not applied'}` : ''}`);
  }
}

// ---------- Amazon helpers ----------

async function readCart(origin: string): Promise<AmazonCart> {
  const r = await read(`${origin}${AMAZON.cart.url}`, 'amazon.cart', { noPool: true, claude: 'cart', op: 'cart.read' });
  if (!r.ok) throw new Error('Could not read the cart');
  return r.value as AmazonCart;
}

async function setQty(tabId: number, origin: string, asin: string, qty: number): Promise<AmazonCart> {
  const cartUrl = `${origin}${AMAZON.cart.url}`;
  const ok = async () => { const c = await readCart(origin); return c.lines.find((l) => l.asin === asin)?.qty === qty ? c : null; };
  let result: AmazonCart | null = null;
  await ladder<true>('setQty', [
    { layer: 'B', name: 'cart-controls', timeoutMs: 40000, run: async () => { await ensureOn(tabId, cartUrl); await mustAct(tabId, 'setCartQty', { asin, qty }); result = await ok(); if (!result) throw new Error('quantity not saved'); return true; } },
    { layer: 'E', name: 'ask-you', timeoutMs: 125000, run: async () => { await ensureOn(tabId, cartUrl); await banner(tabId, `Please set the quantity to ${qty} — I will continue automatically.`); return verify(async () => (result = await ok()), 120000); } },
  ]);
  return result!;
}

async function couponFlow(tabId: number, origin: string, code: string, log: Log): Promise<CheckoutState> {
  await ensureOn(tabId, `${origin}${AMAZON.cart.url}`);
  const onCheckout = (u: string) => AMAZON.checkout.urlRe.test(u);
  await ladder<true>('proceedToCheckout', [
    { layer: 'B', name: 'proceed-button', timeoutMs: 30000, run: async () => { await mustAct(tabId, 'proceedToCheckout'); await waitForComplete(tabId, 25000, onCheckout); return true; } },
    { layer: 'A', name: 'checkout-url', timeoutMs: 30000, run: async () => { await navigate(tabId, `${origin}/gp/buy/spc/handlers/display.html?hasWorkingJavascript=1`); const t = await chrome.tabs.get(tabId); if (!onCheckout(t.url ?? '')) throw new Error('not on checkout'); return true; } },
    { layer: 'D', name: 'claude-click', timeoutMs: 45000, run: async () => { await claudeClick(tabId, 'Proceed to checkout (go to the checkout page, do not pay)'); await waitForComplete(tabId, 25000, onCheckout); return true; } },
  ]);
  log('At checkout', true, { layer: lastLayer });

  // Address step needs the user's choice; wait for the payment step.
  let state = await liveParse<CheckoutState>(tabId, 'amazon.checkout');
  if (state.step === 'address') {
    await banner(tabId, 'Choose the delivery address and continue — I will apply the coupon on the payment step.');
    log('Waiting for you to pick the address', true, { layer: 'E' });
    const end = Date.now() + 180000;
    while (state.step !== 'payment' && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 1200));
      state = await liveParse<CheckoutState>(tabId, 'amazon.checkout').catch(() => state);
    }
    if (state.step !== 'payment') throw new Error('Payment step not reached');
  }

  const r = await action(tabId, 'applyCoupon', { code });
  state = (r.ok && r.data) || (await liveParse<CheckoutState>(tabId, 'amazon.checkout'));
  if (r.ok) log(`Coupon ${code}: ${state.couponOk ? 'applied' : 'rejected'}${state.couponMessage ? ` — ${state.couponMessage}` : ''}`, !!state.couponOk, { layer: r.layer });
  else {
    if (r.blocked) throw new BlockedError(r.blocked as any, r.error);
    log(`Coupon field not usable (${r.error}); please enter ${code} yourself`, false, { layer: 'E' });
    await banner(tabId, `Please enter coupon ${code} and press Apply.`);
  }
  return state;
}

async function ensureOn(tabId: number, url: string) {
  const t = await chrome.tabs.get(tabId);
  if (!sameProduct(t.url, url) && t.url?.split('?')[0] !== url.split('?')[0]) await navigate(tabId, url);
}

function sameProduct(a: string | undefined, b: string) {
  const asin = (u: string | undefined) => u?.match(AMAZON.asinFromUrl)?.[1]?.toUpperCase();
  return !!a && !!asin(a) && asin(a) === asin(b);
}
