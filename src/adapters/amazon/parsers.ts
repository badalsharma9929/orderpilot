import { AMAZON as S } from './selectors';
import { attrOf, clean, detectCaptcha, labelled, pageText, priceOf, textOf, toIsoDate } from '../common';
import { parseInr } from '@/core/qty';
import { normalizeStatus } from '@/core/status';
import type { OrderDetail, OrderItem, Tracking, InvoiceRef } from '@/core/schemas';

export interface PageFlags { captcha: boolean; signedOut: boolean }

export function pageFlags(doc: Document, url = ''): PageFlags {
  const greeting = textOf(doc, S.account.greeting);
  const signin = /\/ap\/signin|\/ap\/mfa|\/ap\/cvf/.test(url) || !!doc.querySelector('form[name="signIn"], #ap_email, #auth-mfa-otpcode');
  return { captcha: detectCaptcha(doc), signedOut: signin || S.account.signedOutText.test(greeting) };
}

export function parseAccount(doc: Document): { name: string; business: boolean } | null {
  const g = textOf(doc, S.account.greeting);
  if (!g || S.account.signedOutText.test(g)) return null;
  const name = clean(g.replace(/^hello,?\s*/i, ''));
  if (!name) return null;
  const business = /business\.amazon/.test(doc.location?.hostname ?? '') || !!doc.querySelector('#nav-ab-logo, .ab-nav, [data-nav-ref*="ab_"]');
  return { name, business };
}

export interface AmazonProduct { asin: string; title: string; unitPrice: number | null; maxQty: number; inStock: boolean; hasCoupon: boolean }

export function parseProduct(doc: Document, url: string): AmazonProduct {
  const asin = attrOf(doc, ['input#ASIN', 'input[name="ASIN"]'], 'value')
    || url.match(S.asinFromUrl)?.[1]
    || attrOf(doc, ['#averageCustomerReviews[data-asin]'], 'data-asin')
    || '';
  const options = Array.from(doc.querySelectorAll(`${S.product.qtySelect.join(', ')} option`))
    .map((o) => Number((o as HTMLOptionElement).value || o.textContent))
    .filter((n) => Number.isFinite(n) && n > 0);
  const avail = textOf(doc, S.product.availability).toLowerCase();
  const inStock = !/currently unavailable|out of stock|unavailable/.test(avail) && !!doc.querySelector(S.product.addToCartButton.join(', '));
  const hasCoupon = !!doc.querySelector(S.product.couponCheckbox.join(', ')) || /apply\s+₹?\s*[\d,]+.*coupon|apply\s+\d+%\s+coupon/i.test(doc.body?.textContent ?? '');
  return {
    asin: asin.toUpperCase(),
    title: textOf(doc, S.product.title),
    unitPrice: priceOf(doc, S.product.price),
    // No dropdown = Amazon will accept a typed quantity; 999 is the cart's own ceiling.
    maxQty: options.length ? Math.max(...options) : 999,
    inStock,
    hasCoupon,
  };
}

export interface CartLine { asin: string; title: string; qty: number; unitPrice: number | null }
export interface AmazonCart { lines: CartLine[]; subtotal: number | null; itemCount: number | null }

export function parseCart(doc: Document): AmazonCart {
  const seen = new Set<string>();
  const lines: CartLine[] = [];
  for (const sel of S.cart.item) {
    doc.querySelectorAll(sel).forEach((el) => {
      const asin = el.getAttribute('data-asin') ?? '';
      if (!asin || seen.has(asin)) return;
      seen.add(asin);
      const qtyAttr = Number(el.getAttribute('data-quantity'));
      const qtyField = el.querySelector<HTMLInputElement | HTMLSelectElement>('input[name="quantityBox"], select[name="quantity"], [data-a-selector="value"]');
      const qtyText = qtyField ? ('value' in qtyField && qtyField.value) || qtyField.textContent : '';
      lines.push({
        asin,
        title: clean(el.querySelector('.sc-product-title, .a-truncate-full, .sc-grid-item-product-title')?.textContent),
        qty: Number.isFinite(qtyAttr) && qtyAttr > 0 ? qtyAttr : Number(clean(String(qtyText))) || 1,
        unitPrice: Number(el.getAttribute('data-price')) || parseInr(el.querySelector('.sc-product-price, .a-price .a-offscreen')?.textContent),
      });
    });
    if (lines.length) break;
  }
  const subtotal = priceOf(doc, S.cart.subtotal);
  const countText = textOf(doc, ['#sc-subtotal-label-activecart']);
  const itemCount = Number(countText.match(/(\d+)\s*item/i)?.[1] ?? textOf(doc, ['#nav-cart-count'])) || null;
  return { lines, subtotal, itemCount };
}

export type CheckoutStep = 'address' | 'payment' | 'review' | 'unknown';

export interface CheckoutState {
  step: CheckoutStep;
  codeInputPresent: boolean;
  couponMessage: string;
  couponOk: boolean | null;
  discount: number | null;
  orderTotal: number | null;
}

export function parseCheckout(doc: Document): CheckoutState {
  const text = pageText(doc);
  const codeInputPresent = !!doc.querySelector(S.checkout.codeInput.join(', '));
  const step: CheckoutStep = codeInputPresent || S.checkout.paymentStepText.test(text)
    ? 'payment'
    : S.checkout.addressStepText.test(text) ? 'address'
    : /review your order|place your order/i.test(text) ? 'review' : 'unknown';
  const alert = clean(doc.querySelector('.pmts-claim-code-error, .pmts-claim-code-success, #gc-promo-error, .a-alert-error .a-alert-content, .a-alert-success .a-alert-content')?.textContent);
  const msgLine = alert || text.split('\n').find((l) => S.checkout.successText.test(l) || (/code/i.test(l) && S.checkout.errorText.test(l))) || '';
  const couponOk = !msgLine ? null : S.checkout.successText.test(msgLine) && !S.checkout.errorText.test(msgLine);
  const promo = text.match(S.checkout.promoLine);
  const discount = promo ? parseInr(promo[1] ?? promo[2]) : null;
  const orderTotal = parseInr(text.match(S.checkout.orderTotal)?.[1]);
  return { step, codeInputPresent, couponMessage: msgLine, couponOk: discount ? true : couponOk, discount, orderTotal };
}

export function parseConfirmation(doc: Document, url: string): string[] {
  const text = pageText(doc);
  if (!S.confirmation.urlRe.test(url) && !S.confirmation.text.test(text)) return [];
  return [...new Set(text.match(new RegExp(S.orderIdRe.source, 'g')) ?? [])];
}

export interface OrderListEntry { orderId: string; orderDate?: string; total?: number; status?: string; detailHref?: string }

export function parseOrderList(doc: Document): { orders: OrderListEntry[]; nextHref: string | null } {
  const cards: Element[] = [];
  for (const sel of S.orders.card) {
    doc.querySelectorAll(sel).forEach((c) => cards.push(c));
    if (cards.length) break;
  }
  const out = new Map<string, OrderListEntry>();
  const fromBlock = (block: string, el?: Element, knownId?: string) => {
    const id = knownId ?? block.match(S.orderIdRe)?.[1];
    if (!id || out.has(id)) return;
    const date = labelled(block, /order placed/);
    const total = parseInr(labelled(block, /total/));
    const status = block.split('\n').find((l) => /^(delivered|arriving|out for delivery|shipped|cancel|refund|return|not yet|now arriving|delayed)/i.test(l));
    const detailHref = el?.querySelector('a[href*="order-details"]')?.getAttribute('href') ?? undefined;
    out.set(id, { orderId: id, orderDate: date ? toIsoDate(date) : undefined, total: total ?? undefined, status, detailHref });
  };
  if (cards.length) cards.forEach((c) => fromBlock(blockText(c), c));
  // Text fallback: every order ID anywhere on the page, so a card redesign never loses orders.
  const whole = pageText(doc);
  for (const m of whole.matchAll(new RegExp(S.orderIdRe.source, 'g'))) if (!out.has(m[1])) fromBlock(whole.slice(Math.max(0, m.index! - 400), m.index! + 600), undefined, m[1]);
  const nextHref = attrOf(doc, S.orders.nextPage, 'href') || null;
  return { orders: [...out.values()], nextHref };
}

function blockText(el: Element) {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('script, style').forEach((n) => n.remove());
  clone.querySelectorAll('div, span, li, br').forEach((n) => n.append('\n'));
  return (clone.textContent ?? '').split('\n').map(clean).filter(Boolean).join('\n');
}

export interface AmazonOrderPage { detail: OrderDetail; trackHrefs: string[]; invoiceHref: string | null }

export function parseOrderDetail(doc: Document, orderIdHint?: string): AmazonOrderPage {
  const text = pageText(doc);
  const orderId = orderIdHint ?? text.match(S.orderIdRe)?.[1] ?? '';
  const items: OrderItem[] = [];
  const seen = new Set<string>();
  for (const sel of S.orders.itemTitle) {
    doc.querySelectorAll(sel).forEach((a) => {
      const title = clean(a.textContent);
      if (!title || seen.has(title)) return;
      seen.add(title);
      const box = a.closest('.a-fixed-left-grid, .yohtmlc-item, [data-component="purchasedItems"] > div, .a-row') ?? a.parentElement!;
      const boxText = box ? blockText(box) : '';
      const href = a.getAttribute('href') ?? (a.closest('a')?.getAttribute('href') ?? '');
      items.push({
        productId: href.match(S.asinFromUrl)?.[1],
        title,
        qty: Number(boxText.match(/(?:qty|quantity)\s*:?\s*(\d+)/i)?.[1] ?? box?.querySelector('.item-view-qty, .od-item-view-qty')?.textContent?.trim() ?? 1) || 1,
        unitPrice: parseInr(box?.querySelector('.a-color-price, .a-price .a-offscreen')?.textContent) ?? undefined,
        seller: clean(boxText.match(/sold by:?\s*([^\n|]+)/i)?.[1]) || undefined,
        url: href || undefined,
      });
    });
    if (items.length) break;
  }
  const orderDate = labelled(text, /order placed(?: on)?|ordered on/);
  const grand = labelled(text, /grand total|order total/);
  const sub = labelled(text, /item\(s\) subtotal|items subtotal/);
  const promo = labelled(text, /promotion applied|coupon savings|discount/, /-?\s*₹?\s*([\d,]+(?:\.\d{1,2})?)/);
  const payment = labelled(text, /payment method/);
  const addressBlock = text.match(/(?:shipping|delivery) address\n([\s\S]{0,300})/i)?.[1] ?? '';
  const pincode = addressBlock.match(/\b(\d{6})\b/)?.[1];
  const city = clean(addressBlock.split('\n').find((l) => /\b\d{6}\b/.test(l))?.replace(/,?\s*\d{6}.*$/, '').split(',').pop());
  const statusLine = textOf(doc, ['.yohtmlc-shipment-status-primaryText', '.od-status-message', '.js-shipment-info-container .a-text-bold', '[data-component="shipmentStatus"]'])
    || text.split('\n').find((l) => /^(delivered|arriving|out for delivery|shipped|cancel|refund|return|not yet|now arriving|delayed|order received)/i.test(l)) || '';
  const trackHrefs = Array.from(doc.querySelectorAll(S.orders.trackLink.join(', '))).map((a) => a.getAttribute('href') ?? '').filter(Boolean);
  const invoiceHref = attrOf(doc, S.orders.invoiceLink, 'href') || null;

  const detail: OrderDetail = {
    platform: 'amazon',
    orderId,
    orderDate: orderDate ? toIsoDate(orderDate) : undefined,
    items,
    total: parseInr(grand) ?? undefined,
    subtotal: parseInr(sub) ?? undefined,
    discount: parseInr(promo) ?? undefined,
    paymentMode: payment || undefined,
    shipCity: city || undefined,
    pincode,
    invoiceAvailable: !!invoiceHref,
    tracking: statusLine ? { status: normalizeStatus(statusLine), rawStatus: statusLine, events: [] } : undefined,
  };
  return { detail, trackHrefs: [...new Set(trackHrefs)], invoiceHref };
}

export function parseTracking(doc: Document): Tracking {
  const text = pageText(doc);
  const primary = textOf(doc, S.tracking.primary) || text.split('\n').find((l) => /^(delivered|arriving|out for delivery|shipped|in transit|cancel|refund|return|delayed|package was|your package)/i.test(l)) || '';
  const secondary = textOf(doc, S.tracking.secondary);
  const carrierRaw = textOf(doc, S.tracking.carrier) || labelled(text, /(?:shipped with|delivery by|carrier)/);
  const trackingRaw = textOf(doc, S.tracking.trackingId) || labelled(text, /tracking id|tracking number|awb/, /([A-Z0-9-]{6,})/);
  const events: Tracking['events'] = [];
  let day = '';
  doc.querySelectorAll(`${S.tracking.eventDay.join(', ')}, ${S.tracking.eventRow.join(', ')}`).forEach((el) => {
    if (S.tracking.eventDay.some((s) => el.matches(s))) { day = clean(el.textContent); return; }
    const parts = Array.from(el.querySelectorAll('span, div')).map((n) => clean(n.textContent)).filter(Boolean);
    const time = parts.find((p) => /\d{1,2}:\d{2}/.test(p)) ?? '';
    const msg = parts.find((p) => p !== time && p.length > 3) ?? clean(el.textContent);
    const loc = parts.find((p) => p !== time && p !== msg && /^[A-Z][A-Za-z .,-]+$/.test(p));
    if (msg) events.push({ at: clean(`${day} ${time}`), text: msg, location: loc });
  });
  const statusText = clean(`${primary} ${secondary}`);
  const eta = primary.match(/arriving\s+(.+)/i)?.[1] ?? labelled(text, /expected (?:by|delivery)|arriving/);
  return {
    status: normalizeStatus(statusText),
    rawStatus: statusText,
    courier: clean(carrierRaw.replace(/^(shipped with|delivery by)\s*/i, '')) || undefined,
    awb: clean(trackingRaw.replace(/^tracking id:?\s*/i, '')) || undefined,
    eta: eta && !/delivered/i.test(primary) ? clean(eta) : undefined,
    deliveredAt: /delivered/i.test(primary) ? clean(primary.replace(/^delivered\s*/i, '')) || undefined : undefined,
    events,
  };
}

export function parseInvoiceLinks(doc: Document, orderId: string, base = 'https://www.amazon.in'): InvoiceRef[] {
  const refs: InvoiceRef[] = [];
  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href')!;
    const label = clean(a.textContent);
    const isPdf = /\/documents\/download\/|invoice\.pdf|\.pdf(\?|$)/i.test(href);
    if (!isPdf && !/^invoice\s*\d*$/i.test(label)) return;
    if (/print\.html|summary/i.test(href)) return;
    const url = new URL(href, base).toString();
    const invoiceNo = href.match(/\/documents\/download\/([^/]+)\//)?.[1] ?? (label || `invoice-${refs.length + 1}`);
    if (!refs.some((r) => r.url === url)) refs.push({ orderId, invoiceNo: invoiceNo.replace(/\s+/g, '-'), url });
  });
  return refs;
}
