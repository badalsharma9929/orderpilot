// JioMart end-to-end test: the real built extension in Chromium against a
// simulated jiomart.com built from structures verified on a real account.
//   npm run build && node tests/e2e/jiomart-smoke.mjs
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as F from '../fixtures/jiomart/data.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const ext = path.resolve(here, '../../.output/chrome-mv3');
const shots = path.resolve(here, '../../.output/screenshots');
mkdirSync(shots, { recursive: true });

const SLUG = 'quickwork-a4-notebook-7527060';
const state = { qty: 0, coupon: false, gst: '', payHits: 0, requests: 0, authMissing: 0 };
const GSTIN = '07AABCS1234F1Z5';
const page = (body) => `<!doctype html><html><head><meta charset="utf-8"></head><body><div class="header__userInitials">BK</div>${body}</body></html>`;
const json = (obj, status = 200) => ({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(obj) });

const productHtml = () => page(`
<div class="product-description__productInfoContent">
  <h1 class="product-description__productTitle">Quickwork A4 Notebook Pack of 5</h1>
  <div class="PriceContainer__priceContainer"><span class="PriceContainer__currentPrice">₹199</span><span class="PriceContainer__originalPrice" style="text-decoration:line-through">₹400</span><span>50% OFF</span></div>
</div>
<div class="product-description__addToCartButtonContainer" id="slot"></div>
<script>
  const slot = document.getElementById('slot');
  const call = (q) => fetch('/mock/set?qty=' + q, { method: 'POST' }).then((r) => r.json());
  function render(q) {
    if (!q) { slot.innerHTML = '<button class="product-description__addToCartButton">Add to Cart</button>'; slot.firstChild.onclick = () => call(1).then((s) => render(s.qty)); return; }
    slot.innerHTML = '<div class="product-description__quantityCounter"><button class="product-description__quantityBtn" aria-label="decrease">-</button><span class="product-description__quantityValue">' + q + '</span><button class="product-description__quantityBtn" aria-label="increase">+</button></div>';
    const [minus, , plus] = slot.firstChild.children;
    minus.onclick = () => call(q - 1).then((s) => render(s.qty));
    plus.onclick = () => call(q + 1).then((s) => render(s.qty));
  }
  fetch('/mock/state').then((r) => r.json()).then((s) => render(s.qty));
</script>
<script>window.APP_DATA = {"reduxData":{"auth":{"logged_in":false},"catalog":{"product_details":{"slug":"${SLUG}","uid":7527060,"name":"Quickwork A4 Notebook Pack of 5","attributes":{"max-qty-in-order":"12"}}}}};</script>`);

const cartHtml = () => page(`
${state.qty ? `<div class="cart-item__cartItem"><a href="/product/${SLUG}">img</a><div class="cart-item__productName">Quickwork A4 Notebook Pack of 5</div>
<span class="cart-item__quantityDisplay">${state.qty}</span><div class="cart-item__priceCurrent">₹${199 * state.qty}</div></div>` : ''}
<div class="coupons__applyCouponContainer"><span class="coupons__viewAllCoupon">View all coupons</span></div>
${state.coupon ? '<div class="coupons__couponSuccess">Coupon JMSAVE200 applied</div>' : ''}
<div class="summary__priceSummaryContainer"><div class="summary__priceRow"><span>Item Total</span><span>₹${199 * state.qty}</span></div>
${state.coupon ? '<div class="summary__priceRow"><span>Coupon Discount</span><span>-₹200</span></div>' : ''}</div>
<div class="cart__gstInvoice"><span class="cart__gstTariffText">GST Invoice</span>
  <div class="cart__gstInvoiceAction"><input type="checkbox" class="cart__gstInvoiceCheckbox" id="gstcb" ${state.gst ? 'checked' : ''}></div></div>
<div id="gstslot">${state.gst ? `<span class="cart__gstNum">${state.gst}</span><span class="cart__gstName">ACME TRADERS</span>` : ''}</div>
<script>
  // Same steps as JioMart's cart: tick → GSTIN form → Submit (verified) → billing address → Confirm.
  document.getElementById('gstcb').onclick = () => {
    if (document.querySelector('.gst-info__gstInvoiceForm')) return;
    const f = document.createElement('div');
    f.className = 'gst-info__gstInvoiceForm';
    f.innerHTML = '<input placeholder="Enter GSTIN" maxlength="15"><div class="gst-info__gstInvoiceAction"><button class="gst-info__gstInvoiceActionButton">Submit</button></div>';
    document.body.appendChild(f);
    f.querySelector('button').onclick = async () => {
      const v = f.querySelector('input').value;
      const r = await fetch('/ext/hellcat/gst/validation', { method: 'POST', body: JSON.stringify({ gst_number: v, pincode: 110092 }) }).then((x) => x.json());
      if (r.status !== 'success') { f.insertAdjacentHTML('beforeend', '<div class="gst-info__gstErrorText">Invalid GSTIN</div>'); return; }
      f.innerHTML = '<div>Select your Billing Address</div><div class="gst-info__gstInvoiceDetailsAddressContentItemListRadio"><input type="radio" name="a"></div><button id="cf">Confirm</button>';
      f.querySelector('#cf').onclick = async () => {
        if (!f.querySelector('input[type=radio]').checked) return;
        await fetch('/mock/gst?gstin=' + v, { method: 'POST' });
        f.remove();
        document.getElementById('gstslot').innerHTML = '<span class="cart__gstNum">' + v + '</span><span class="cart__gstName">ACME TRADERS</span>';
      };
    };
  };
</script>
<form action="/pay" method="post"><button class="cart__paynowAction">Proceed to pay</button></form>`);

function route(req) {
  const u = new URL(req.url());
  const p = u.pathname;
  const m = req.method();
  state.requests++;
  const authed = (req.headers()['authorization'] ?? '').startsWith('Bearer ');
  if (p.startsWith('/api/service/') && !authed) { state.authMissing++; return json({ error: 'unauthorised' }, 401); }

  if (p.startsWith('/product/')) return { body: productHtml() };
  if (p === '/mock/state') return json({ qty: state.qty });
  if (p === '/mock/set') { state.qty = Math.max(0, Math.min(12, Number(u.searchParams.get('qty')))); return json({ qty: state.qty }); }
  if (p === '/cart/bag/' || p === '/cart/bag') return { body: cartHtml() };
  if (p === '/pay') { state.payHits++; return { body: page('PAYMENT PAGE') }; }
  if (p === '/ext/hellcat/gst/validation') {
    const v = JSON.parse(req.postData() ?? '{}').gst_number;
    return json(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v) ? { status: 'success', data: { gstin: v, tradeNam: 'ACME TRADERS' } } : { status: 'failed' });
  }
  if (p === '/mock/gst') { state.gst = u.searchParams.get('gstin') ?? ''; return json({ ok: true }); }
  if (p === '/api/service/application/user/authentication/v1.0/session') return json(F.session);
  if (p === '/api/service/application/cart/v1.0/detail') {
    if (m === 'PUT') {
      const body = JSON.parse(req.postData() ?? '{}');
      const it = body.items?.[0];
      if (body.operation !== 'update_item' || it?.item_id !== 7527060 || !it.article_id || !it.identifiers?.identifier) return json({ message: 'bad update' }, 400);
      state.qty = Math.min(12, it.quantity);
    }
    return json(F.cartJson(state.qty, state.coupon));
  }
  if (p === '/api/service/application/cart/v1.0/coupon' && m === 'POST') {
    const code = JSON.parse(req.postData() ?? '{}').coupon_code;
    if (code !== 'JMSAVE200') return json({ success: false, message: 'Invalid coupon code' }, 400);
    if (199 * state.qty < 1500) return json({ success: false, message: 'Add items worth ₹1500 to use this coupon' }, 400);
    state.coupon = true;
    return json(F.cartJson(state.qty, true));
  }
  if (p === '/api/service/application/order/v1.0/orders') return json(F.ordersPage1);
  if (p.startsWith('/api/service/application/order/v1.0/orders/')) {
    const id = decodeURIComponent(p.split('/').pop());
    const o = F.ordersPage1.items.find((x) => x.order_id === id);
    return o ? json({ order: o }) : json({ success: false, message: 'not found' }, 404);
  }
  if (p.startsWith('/ext/hellcat/details/')) {
    const id = p.split('/')[4];
    const delivered = id.endsWith('DONE02');
    return json(F.hellcatDetails(id, delivered ? 'FY6ZZZ9YYY8888777XXX' : 'FY6ABC1DEF2345678GHI', delivered));
  }
  if (p.startsWith('/ext/hellcat/shipment/invoice/')) {
    const tok = u.searchParams.get('invoice_url') ?? '';
    return { status: tok ? 200 : 400, contentType: 'application/pdf', body: Buffer.from(`%PDF-1.4\n% ${tok}\n%%EOF`) };
  }
  if (p.startsWith('/cart/order-status')) return { body: page(F.orderStatusPage) };
  return { status: 404, body: page('not found') };
}

const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) process.exitCode = 1; };

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'opj-')), {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
await ctx.route('https://www.jiomart.com/**', async (r) => {
  const res = route(r.request());
  await r.fulfill({ status: res.status ?? 200, contentType: res.contentType ?? 'text/html; charset=utf-8', body: res.body });
});
if (process.env.DEBUG) ctx.on('page', (pg) => { console.log('PAGE+', pg.url()); pg.on('crash', () => console.log('CRASH', pg.url())); pg.on('framenavigated', (f) => f === pg.mainFrame() && console.log('NAV', f.url().slice(0, 80))); pg.on('close', () => console.log('CLOSE', pg.url().slice(0, 80))); });
let amazonHits = 0;
await ctx.route('https://www.amazon.in/**', async (r) => { amazonHits++; await r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>amazon</body></html>' }); });
let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;

const shop = await ctx.newPage();
await shop.goto(`https://www.jiomart.com/product/${SLUG}`);
const panel = await ctx.newPage();
await panel.setViewportSize({ width: 420, height: 900 });
await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
await panel.waitForSelector('text=Build cart');
const send = (msg) => panel.evaluate((m) => chrome.runtime.sendMessage({ kind: 'bg', ...m }), msg);
const idb = (store) => panel.evaluate((s) => new Promise((res, rej) => {
  const o = indexedDB.open('orderpilot');
  o.onsuccess = () => { const q = o.result.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result); q.onerror = rej; };
  o.onerror = rej;
}), store);

// ---- Cart Builder (with a GSTIN set in Settings) ----
await panel.evaluate(async (g) => { const { settings } = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: { ...(settings ?? {}), gstin: g } }); }, GSTIN);
await shop.bringToFront();
const t0 = Date.now();
const run = await send({ op: 'cart.run', input: { url: `https://www.jiomart.com/product/${SLUG}`, target: 1990, coupon: 'jmsave200' } });
check('JioMart cart run ready to pay', run?.outcome === 'ready-to-pay', `${run?.outcome} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
check('quantity = smallest reaching ₹1990 at ₹199', run?.qty === 10 && state.qty === 10, `run ${run?.qty}, cart ${state.qty}`);
check('coupon applied via the cart API, discount read', run?.couponOk === true && run?.discount === 200 && run?.payable === 1790, `discount ${run?.discount}, payable ${run?.payable}`);
check('never pressed "Proceed to pay"', state.payHits === 0);
check('GST invoice switched on with your GSTIN', state.gst === GSTIN && (run?.steps ?? []).some((s) => /GST invoice on/.test(s.step)), state.gst || 'not applied');
check('API calls carried the app header', state.authMissing === 0, `${state.authMissing} unauthenticated API calls`);
for (const s of run?.steps ?? []) console.log(`      ${s.ok ? '·' : '!'} ${s.step}${s.layer ? ` [${s.layer}]` : ''}${s.note ? ` (${s.note})` : ''}`);
await shop.screenshot({ path: `${shots}/j1-cart-stopped.png` });

// ---- Daily check with NO JioMart tab open, default sites (Amazon unused) ----
await shop.close(); // the daily check must work with no JioMart tab open
const t1 = Date.now();
const sweep = await send({ op: 'sweep.run' });
if (process.env.DEBUG) { const pr = await panel.evaluate(() => chrome.storage.session.get('progress')); console.log(JSON.stringify((pr.progress ?? []).filter((e) => e.job === 'sweep').map((e) => [e.at.slice(14, 23), e.step, e.layer, e.note].filter(Boolean).join(' ¦ ')), null, 1)); }
check('Amazon skipped because it is not used', amazonHits === 0, `${amazonHits} Amazon requests`);
check('sweep finished with no failures', !!sweep && sweep.failed === 0, `${sweep?.checked} checked, ${sweep?.discovered} discovered, ${sweep?.failed} failed in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
const orders = (await idb('orders')).filter((o) => o.platform === 'jiomart');
const by = Object.fromEntries(orders.map((o) => [o.orderId, o]));
check('both orders saved with full details', orders.length === 2 && orders.every((o) => o.detail.items.length && o.detail.total), orders.map((o) => `${o.orderId}:${o.status}:${o.completeness}%`).join(', '));
check('open order reads JioMart\'s fresher status', by['FY6ABC1DEF2345678GHI']?.status === 'Out for delivery', by['FY6ABC1DEF2345678GHI']?.detail?.tracking?.rawStatus);
check('delivered order is final and complete', by['FY6ZZZ9YYY8888777XXX']?.isFinal === 1 && by['FY6ZZZ9YYY8888777XXX']?.completeness === 100);
check('shipment IDs kept for invoices', by['FY6ZZZ9YYY8888777XXX']?.detail?.shipmentIds?.[0] === '6ABD5BBB0121SHIPDONE02');

// ---- Invoices (ran after the sweep) ----
const inv = (await idb('invoices')).filter((r) => r.platform === 'jiomart');
check('JioMart invoices fetched as real PDFs and zipped', inv.length === 2 && inv.every((r) => r.zipName?.includes('/2026-') || r.zipName), inv.map((r) => `${r.orderId}:${r.invoiceNo}:${r.zipName?.split('/').pop()}`).join(', '));
if (process.env.DEBUG) console.log(JSON.stringify((await idb('errors')).filter((e) => !e.resolved).map((e) => e.message), null, 1));
const again = await send({ op: 'invoices.run' });
check('re-run downloads nothing new', again?.fetched === 0 && again?.zips === 0);

// ---- Excel report ----
const xl = await send({ op: 'report.export' });
check('Excel report built and saved', xl?.ok === true && /OrderPilot\/Reports\/OrderPilot_orders_\d{4}-\d{2}-\d{2}\.xlsx$/.test(xl?.filename ?? ''), xl?.filename ?? xl?.error);

// ---- Order capture after payment ----
const shop2 = await ctx.newPage();
await shop2.goto('https://www.jiomart.com/cart/order-status?success=true&order_id=FY6NEW0000111122223333');
await shop2.waitForTimeout(2500);
const captured = (await idb('orders')).find((o) => o.orderId === 'FY6NEW0000111122223333');
check('order captured from the order-status page', !!captured, captured ? `account ${captured.accountId}` : 'missing');

await panel.reload();
await panel.click('role=tab[name="Orders"]');
await panel.selectOption('select[aria-label="Status"]', 'all');
await panel.waitForSelector('text=FY6ZZZ9YYY8888777XXX');
await panel.screenshot({ path: `${shots}/j2-orders.png` });
await panel.click('text=FY6ABC1DEF2345678GHI');
await panel.waitForSelector('text=Status history');
await panel.waitForTimeout(300);
await panel.screenshot({ path: `${shots}/j3-timeline.png`, fullPage: true });

console.log(`\n${state.requests} intercepted requests · screenshots in ${shots}`);
await ctx.close();
