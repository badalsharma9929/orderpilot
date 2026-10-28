// End-to-end smoke test: real built extension in Chromium, with amazon.in
// intercepted and served from fixtures. Never touches the real site.
//   npm run build && node tests/e2e/smoke.mjs
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as F from '../fixtures/amazon/pages.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const ext = path.resolve(here, '../../.output/chrome-mv3');
const shots = path.resolve(here, '../../.output/screenshots');
mkdirSync(shots, { recursive: true });

const html = (body) => `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="nav-link-accountList"><span id="nav-link-accountList-nav-line-1">Hello, Badal</span></div>${body}</body></html>`;
const state = { cartQty: 0, placeOrderHits: 0, requests: 0 };

const cartPage = () => html(`
<div id="sc-active-cart">${state.cartQty ? `
  <div class="sc-list-item" data-asin="B0TESTASIN" data-quantity="${state.cartQty}" data-price="499.0" data-itemtype="active">
    <span class="sc-product-title">Classmate Notebook</span>
    <input name="quantityBox" value="${state.cartQty}"><a data-action="update" href="#" onclick="return false">Update</a>
  </div>` : ''}
</div>
<span id="sc-subtotal-label-activecart">Subtotal (${state.cartQty} items):</span>
<span id="sc-subtotal-amount-activecart"><span class="a-price"><span class="a-offscreen">₹${(state.cartQty * 499).toLocaleString('en-IN')}.00</span></span></span>
<form action="/gp/buy/spc/handlers/display.html" method="get"><input name="proceedToRetailCheckout" type="submit" value="Proceed to Buy"></form>`);

const checkoutPage = () => html(`
<h1>Select a payment method</h1>
<a href="#" id="enter-code" onclick="document.getElementById('promo').style.display='block';return false;">Enter code</a>
<div id="promo" style="display:none">
  <input name="ppw-claimCode" placeholder="Enter Code">
  <input name="ppw-claimCodeApplyPressed" type="submit" value="Apply" onclick="
    var c=document.querySelector('[name=ppw-claimCode]').value;
    var t=document.getElementById('totals');
    if(c==='SAVE10'){document.getElementById('msg').innerHTML='<div class=&quot;pmts-claim-code-success&quot;>Your promotion code SAVE10 has been applied.</div>';
      t.innerHTML='<div>Items: ₹${(state.cartQty * 499).toLocaleString('en-IN')}.00</div><div>Promotion Applied: -₹500.00</div><div>Order Total: ₹${(state.cartQty * 499 - 500).toLocaleString('en-IN')}.00</div>';}
    else {document.getElementById('msg').innerHTML='<div class=&quot;pmts-claim-code-error&quot;>The promotional code you entered is not valid.</div>';}
    return false;">
</div>
<div id="msg"></div>
<div id="totals"><div>Order Total: ₹${(state.cartQty * 499).toLocaleString('en-IN')}.00</div></div>
<form action="/place-order" method="post"><input name="placeYourOrder1" type="submit" value="Place your order"></form>`);

// Page 2 of the order history: one older order and no "Next" link.
const PAGE2 = `<div class="order-card"><div><span>Order placed</span><span>1 August 2026</span></div><div><span>Total</span><span>₹250.00</span></div>
  <div><span>Order #</span><span>401-0000000-0000002</span></div><div><span>Delivered 4 August</span></div></div>`;

const detailFor = (id) => {
  const delivered = id.startsWith('171') || id.startsWith('401');
  return html(F.orderDetail
    .replaceAll('403-1234567-7654321', id)
    .replace('Arriving tomorrow', delivered ? 'Delivered 30 September' : 'Arriving tomorrow'));
};
const trackingFor = (id) => html(/^(171|401)/.test(id) ? F.trackingDelivered : F.tracking);
const popoverFor = (id) => html(id.startsWith('171')
  ? '<a href="/documents/download/dup-copy-0001/invoice.pdf">Invoice 1</a>'
  : `<a href="/documents/download/inv-${id}/invoice.pdf">Invoice 1</a>`);
// The 171 invoice is byte-identical to the 403 one: must be skipped by hash.
const pdfFor = (docId) => Buffer.from(`%PDF-1.4\n% ${docId.startsWith('dup-copy') ? 'inv-403-1234567-7654321' : docId}\n%%EOF`);

function route(url, req) {
  const u = new URL(url);
  const p = u.pathname;
  const q = u.searchParams;
  state.requests++;
  if (p.startsWith('/dp/')) return { body: html(F.product.replace(/<span id="nav-link-accountList-nav-line-1">[^<]*<\/span>/, '')) };
  if (p.startsWith('/gp/product/handle-buy-box')) {
    const m = (req.postData() ?? '').match(/name="quantity"\r\n\r\n(\d+)/);
    state.cartQty += m ? Number(m[1]) : 1;
    return { body: html('<h1>Added to Cart</h1>') };
  }
  if (p === '/gp/cart/view.html') return { body: cartPage() };
  if (p.startsWith('/gp/buy/spc')) return { body: checkoutPage() };
  if (p === '/place-order') { state.placeOrderHits++; return { body: html('ORDER PLACED') }; }
  if (p === '/gp/css/homepage.html') return { body: html('<h1>Your Account</h1>') };
  if (/order-history|your-orders\/orders/.test(p)) return { body: html(Number(q.get('startIndex') ?? 0) === 0 ? F.orderList : PAGE2) };
  if (/order-details/.test(p)) return { body: detailFor(q.get('orderID')) };
  if (p.startsWith('/progress-tracker')) return { body: trackingFor(q.get('orderId') ?? '') };
  if (p.startsWith('/gp/shared-cs/ajax/invoice')) return { body: popoverFor(q.get('orderId')) };
  if (p.startsWith('/documents/download/')) return { body: pdfFor(p.split('/')[3]), contentType: 'application/pdf' };
  return { status: 404, body: html('not found') };
}

const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) process.exitCode = 1; };

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'op-')), {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
await ctx.route('https://www.amazon.in/**', async (r) => {
  const res = route(r.request().url(), r.request());
  await r.fulfill({ status: res.status ?? 200, contentType: res.contentType ?? 'text/html; charset=utf-8', body: res.body });
});

let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;

const shop = await ctx.newPage();
await shop.goto('https://www.amazon.in/dp/B0TESTASIN');
const panel = await ctx.newPage();
await panel.setViewportSize({ width: 420, height: 860 });
await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
await panel.waitForSelector('text=Build cart');
await panel.screenshot({ path: `${shots}/1-cart-empty.png` });

const send = (msg) => panel.evaluate((m) => chrome.runtime.sendMessage({ kind: 'bg', ...m }), msg);
const idb = (store) => panel.evaluate((s) => new Promise((res, rej) => {
  const o = indexedDB.open('orderpilot');
  o.onsuccess = () => { const q = o.result.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result); q.onerror = rej; };
  o.onerror = rej;
}), store);

// ---- Cart Builder ----
await shop.bringToFront();
const t0 = Date.now();
const run = await send({ op: 'cart.run', input: { url: 'https://www.amazon.in/dp/B0TESTASIN', target: 5000, coupon: 'SAVE10' } });
const cartMs = Date.now() - t0;
check('cart run ready to pay', run?.outcome === 'ready-to-pay', `${run?.outcome} in ${(cartMs / 1000).toFixed(1)}s`);
check('quantity = smallest reaching ₹5000 at ₹499', run?.qty === 11 && state.cartQty === 11, `qty ${run?.qty}, cart ${state.cartQty}`);
check('coupon applied, discount read', run?.couponOk === true && run?.discount === 500, `discount ${run?.discount}, payable ${run?.payable}`);
check('never clicked Place your order', state.placeOrderHits === 0);
for (const s of run?.steps ?? []) console.log(`      ${s.ok ? '·' : '!'} ${s.step}${s.layer ? ` [${s.layer}]` : ''}${s.note ? ` (${s.note})` : ''}`);
await shop.screenshot({ path: `${shots}/2-checkout-stopped.png` });

await panel.bringToFront();
await panel.reload();
await panel.waitForSelector('text=Recent runs');
await panel.screenshot({ path: `${shots}/3-cart-done.png` });

// ---- Daily sweep ----
const t1 = Date.now();
const sweep = await send({ op: 'sweep.run' });
if (process.env.DEBUG) { console.log(JSON.stringify(sweep)); console.log(JSON.stringify(await idb('errors'), null, 1).slice(0, 3000)); console.log(JSON.stringify(await idb('ladderStats'))); }
check('sweep finished with no failures', !!sweep && sweep.failed === 0, `${sweep?.checked} checked, ${sweep?.discovered} discovered, ${sweep?.failed} failed in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
const orders = await idb('orders');
const byId = Object.fromEntries(orders.map((o) => [o.orderId, o]));
check('all 4 orders saved across 2 list pages (incl. text-fallback one)', orders.length === 4, orders.map((o) => o.orderId).join(', '));
check('open order tracked with courier + AWB', byId['403-1234567-7654321']?.status === 'Out for delivery' && byId['403-1234567-7654321']?.detail?.tracking?.awb === '1234567890123');
check('final orders discovered from the list still get full details (any age)', ['171-1111111-2222222', '401-0000000-0000002'].every((id) => byId[id]?.detail?.items?.length > 0), `completeness ${byId['171-1111111-2222222']?.completeness}%`);
check('delivered order is final', byId['171-1111111-2222222']?.status === 'Delivered' && byId['171-1111111-2222222']?.isFinal === 1);
const snaps = await idb('dailySnapshots');
check('one snapshot per order today', snaps.length === 4);
const events1 = (await idb('statusEvents')).length;
await send({ op: 'sweep.run' });
check('second sweep adds no duplicate status events', (await idb('statusEvents')).length === events1 && (await idb('dailySnapshots')).length === 4);

// ---- Invoices (the sweep already ran the invoice job twice) ----
const inv = await idb('invoices');
const real = inv.filter((r) => r.zippedAt !== 'duplicate');
check('invoices fetched once, identical PDF skipped by hash', real.length === 3 && inv.some((r) => r.zippedAt === 'duplicate'), inv.map((r) => `${r.orderId}:${r.zippedAt === 'duplicate' ? 'dup' : 'new'}`).join(', '));
check('invoices zipped per account/date', real.every((r) => r.zipName?.startsWith('OrderPilot/Invoices/Badal/')), real[0]?.zipName);
const again = await send({ op: 'invoices.run' });
check('re-run downloads nothing new', again?.fetched === 0 && again?.zips === 0);

// ---- UI screenshots ----
await panel.reload();
await panel.click('role=tab[name="Orders"]');
await panel.selectOption('select[aria-label="Status"]', 'all');
await panel.waitForSelector('text=171-1111111-2222222');
await panel.screenshot({ path: `${shots}/4-orders.png` });
await panel.click('text=403-1234567-7654321');
await panel.waitForSelector('text=Status history');
await panel.screenshot({ path: `${shots}/5-timeline.png`, fullPage: true });
await panel.emulateMedia({ colorScheme: 'dark' });
await panel.waitForTimeout(400); // let colour transitions finish
await panel.screenshot({ path: `${shots}/6-timeline-dark.png`, fullPage: true });
await panel.emulateMedia({ colorScheme: 'light' });
await panel.click('role=tab[name="Invoices"]');
await panel.waitForSelector('text=ZIP files');
await panel.screenshot({ path: `${shots}/7-invoices.png` });

console.log(`\n${state.requests} intercepted requests · screenshots in ${shots}`);
await ctx.close();
