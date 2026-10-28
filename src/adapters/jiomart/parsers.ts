import { JIOMART as S } from './selectors';
import { clean, detectCaptcha, labelled, pageText, textOf, toIsoDate } from '../common';
import { parseInr } from '@/core/qty';
import { normalizeStatus } from '@/core/status';
import type { InvoiceRef, OrderDetail, OrderItem, Tracking } from '@/core/schemas';

// ---------- page data (window.APP_DATA embedded by the server) ----------

/** Reads the server-rendered APP_DATA JSON from the page's script text (content scripts can't see page globals). */
export function appData(doc: Document): any | null {
  for (const s of Array.from(doc.querySelectorAll('script:not([src])'))) {
    const t = s.textContent ?? '';
    const i = t.indexOf('window.APP_DATA');
    if (i < 0) continue;
    const start = t.indexOf('{', i);
    let depth = 0, inStr = false, esc = false;
    for (let k = start; k < t.length; k++) {
      const ch = t[k];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        try { return JSON.parse(t.slice(start, k + 1).replace(/([:,[])undefined(?=[,\]}])/g, '$1null')); } catch { return null; }
      }
    }
  }
  return null;
}

/** Text of all text nodes joined with spaces, so adjacent elements never run together. */
export function spacedText(el: Element): string {
  const out: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) { const t = n.textContent?.trim(); if (t) out.push(t); }
    n.childNodes.forEach(walk);
  };
  walk(el);
  return out.join(' ');
}

// ---------- flags + account ----------

export function pageFlags(doc: Document, url = '') {
  // The embedded APP_DATA is a server snapshot and often says logged_in:false
  // for a signed-in user (verified on a real account), so only a redirect to
  // the login page counts as "signed out".
  const onLogin = /\/auth\/login|retail-auth\/ui\/login/.test(url);
  return { captcha: detectCaptcha(doc), signedOut: onLogin };
}

export function parseAccount(doc: Document): { name: string; business: boolean } | null {
  const auth = appData(doc)?.reduxData?.auth;
  const u = auth?.user_data ?? auth?.user ?? null;
  const fromData = clean([u?.first_name, u?.last_name].filter(Boolean).join(' '));
  if (fromData) return { name: fromData, business: false };
  const name = textOf(doc, S.account.name);
  if (name) return { name, business: false };
  const initials = textOf(doc, S.account.initials);
  return initials ? { name: initials, business: false } : null;
}

/** Fynd session API → account name (layer A for the account check). */
export function parseSessionJson(json: any): { name: string; business: boolean } | null {
  const u = json?.user ?? json;
  const name = clean([u?.first_name, u?.last_name].filter(Boolean).join(' '));
  const phone = u?.phone_numbers?.find?.((p: any) => p.primary)?.phone ?? u?.phone_numbers?.[0]?.phone;
  if (name) return { name, business: false };
  return phone ? { name: `user-${String(phone).slice(-4)}`, business: false } : null;
}

// ---------- product ----------

export interface JioProduct { productId: string; slug: string; title: string; unitPrice: number | null; maxQty: number; inStock: boolean }

export function parseProduct(doc: Document, url: string): JioProduct {
  const m = url.match(S.productUrlRe);
  const data = appData(doc)?.reduxData?.catalog?.product_details;
  const sameProduct = data?.slug && m?.[1] && data.slug === m[1];
  const title = textOf(doc, S.product.title) || (sameProduct ? clean(data.name) : '');
  // The price section shows the selling price and a struck-through MRP; take the first amount outside the MRP.
  // The page has several price boxes (bank offers, EMI, other products). Use the one
  // that sits with the product title: walk up from the title to the first ancestor
  // that contains a selling price. (Bug seen live: ₹1,399 read for a ₹99,900 phone.)
  let unitPrice: number | null = priceNearTitle(doc);
  if (unitPrice == null) unitPrice = parseInr(textOf(doc, S.product.currentPrice).match(/₹\s*([\d,]+(?:\.\d{1,2})?)/)?.[1]);
  for (const sel of unitPrice ? [] : S.product.priceSection) {
    const box = doc.querySelector(sel);
    if (!box) continue;
    const clone = box.cloneNode(true) as Element;
    clone.querySelectorAll(S.product.markedPrice.join(', ') + ', s, del, strike, [class*="discount"], [class*="Badge"]').forEach((n) => n.remove());
    // Read text nodes separately: "₹199" next to "50% OFF" must not merge into "19950".
    unitPrice = parseInr(spacedText(clone).match(/₹\s*([\d,]+(?:\.\d{1,2})?)/)?.[1]);
    if (unitPrice) break;
  }
  const maxFromData = sameProduct ? Number(data?.attributes?.['max-qty-in-order']) : NaN;
  const maxFromText = Number(textOf(doc, S.product.maxQtyText).match(/(\d+)/)?.[1]);
  const maxQty = Number.isFinite(maxFromData) && maxFromData > 0 ? maxFromData : Number.isFinite(maxFromText) && maxFromText > 0 ? maxFromText : 999;
  const hasAdd = !!doc.querySelector([...S.product.addToCart, ...S.product.counter].join(', '));
  const notify = !!doc.querySelector(S.product.notifyMe.join(', ')) || /out of stock|notify me/i.test(textOf(doc, S.product.priceSection));
  return {
    productId: m?.[2] ?? String(data?.uid ?? ''),
    slug: m?.[1] ?? data?.slug ?? '',
    title,
    unitPrice,
    maxQty,
    inStock: hasAdd && !notify,
  };
}

function priceNearTitle(doc: Document): number | null {
  const title = doc.querySelector(S.product.title.join(', '));
  if (!title) return null;
  let node: Element | null = title.parentElement;
  for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
    for (const sel of S.product.currentPrice) {
      const el = node.querySelector(sel);
      const v = el ? parseInr(spacedText(el).match(/₹\s*([\d,]+(?:\.\d{1,2})?)/)?.[1] ?? spacedText(el)) : null;
      if (v) return v;
    }
  }
  return null;
}

/** Quantity currently shown in the product page counter (0 when only "Add" is visible). */
export function productCounter(doc: Document): number {
  const v = textOf(doc, S.product.qtyValue);
  return v ? Number(v.replace(/\D/g, '')) || 0 : 0;
}

// ---------- cart ----------

export interface JioCartLine { productId: string; title: string; qty: number; unitPrice: number | null }
export interface JioCart { lines: JioCartLine[]; subtotal: number | null; itemCount: number | null; discount: number | null; payable: number | null; couponApplied: string | null }

export function parseCart(doc: Document): JioCart {
  const lines: JioCartLine[] = [];
  for (const sel of S.cart.item) {
    const items = Array.from(doc.querySelectorAll(sel));
    if (!items.length) continue;
    for (const el of items) {
      const title = textOf(el, S.cart.name);
      const qty = Number(textOf(el, S.cart.qty).replace(/\D/g, '')) || 1;
      const href = el.querySelector('a[href*="/product/"]')?.getAttribute('href') ?? '';
      lines.push({ productId: href.match(S.productUrlRe)?.[2] ?? '', title, qty, unitPrice: parseInr(textOf(el, S.cart.price)) });
    }
    break;
  }
  const rows = summaryRows(doc);
  const find = (re: RegExp) => rows.find((r) => re.test(r.label))?.value ?? null;
  const subtotal = find(/item\s*total|sub\s*total|cart\s*total|items?\s*\(|mrp\s*total|price\s*\(/i);
  const couponRow = rows.find((r) => /coupon/i.test(r.label));
  const discount = couponRow?.value ?? find(/discount|savings|promotion/i);
  const payable = parseInr(textOf(doc, S.cart.finalAmount)) ?? find(/to\s*pay|grand\s*total|total\s*amount|order\s*total|^total/i);
  const applied = textOf(doc, ['.coupons__couponCode', '.coupons__applyed']);
  const count = Number(textOf(doc, ['.summary__itemCount', '.cart__bagCount']).match(/(\d+)/)?.[1]);
  return {
    lines,
    subtotal: subtotal ?? (lines.length ? lines.reduce((s, l) => s + (l.unitPrice ?? 0) * l.qty, 0) || null : null),
    itemCount: Number.isFinite(count) ? count : lines.reduce((s, l) => s + l.qty, 0) || null,
    discount: discount != null ? Math.abs(discount) : null,
    payable,
    couponApplied: applied || null,
  };
}

function summaryRows(doc: Document): Array<{ label: string; value: number | null }> {
  const rows: Array<{ label: string; value: number | null }> = [];
  for (const sel of S.cart.summaryRow) {
    doc.querySelectorAll(sel).forEach((r) => {
      const parts = Array.from(r.children).map((c) => clean(c.textContent)).filter(Boolean);
      const label = parts[0] ?? clean(r.textContent).replace(/[-−]?\s*₹.*$/, '');
      const valueText = parts.length > 1 ? parts[parts.length - 1] : clean(r.textContent).slice(label.length);
      const negative = /^[-−]/.test(valueText.trim());
      const v = parseInr(valueText);
      rows.push({ label, value: v == null ? null : negative ? -v : v });
    });
    if (rows.length) break;
  }
  return rows;
}

export interface CouponState { ok: boolean | null; message: string }

export function parseCouponState(doc: Document): CouponState {
  const err = textOf(doc, S.coupon.error);
  if (err) return { ok: false, message: err };
  const ok = textOf(doc, S.coupon.success);
  if (ok || doc.querySelector(S.coupon.success.join(', '))) return { ok: true, message: ok || 'Coupon applied' };
  const t = pageText(doc);
  const line = t.split('\n').find((l) => /coupon/i.test(l) && /(applied|saved|success)/i.test(l));
  if (line) return { ok: true, message: line };
  const bad = t.split('\n').find((l) => /coupon/i.test(l) && /(invalid|not\s*applicable|expired|not\s*valid|minimum)/i.test(l));
  return bad ? { ok: false, message: bad } : { ok: null, message: '' };
}

// ---------- order capture ----------

export function parseConfirmation(doc: Document, url: string): string[] {
  if (!S.orderStatus.pathRe.test(url)) return [];
  if (doc.querySelector(S.orderStatus.failed.join(', '))) return [];
  const fromUrl = new URL(url, S.origin).searchParams.get('order_id');
  const ids = new Set<string>();
  if (fromUrl) ids.add(fromUrl);
  const box = textOf(doc, S.orderStatus.orderId);
  const m = box.match(/([A-Z0-9][A-Z0-9-]{7,})/i);
  if (m) ids.add(m[1]);
  const t = pageText(doc).match(S.orderIdRe);
  if (t) ids.add(t[1]);
  return [...ids];
}

// ---------- Fynd API JSON (shapes verified on a real account, 2026-10-09) ----------

export interface JioOrderEntry { orderId: string; orderDate?: string; total?: number; status?: string; shipmentIds: string[] }
export interface InvoiceToken { shipmentId: string; token: string; invoiceNo: string }
export interface JioOrderPage { detail: OrderDetail; shipmentIds: string[]; invoiceTokens: InvoiceToken[] }

const num = (v: unknown) => (v == null || v === '' ? undefined : Number.isFinite(Number(v)) ? Number(v) : parseInr(String(v)) ?? undefined);

/**
 * Status text for a shipment. The orders API gives title "Delivered"; JioMart's
 * details endpoint gives the generic title "Order Status" with the real text in
 * value ("Delivered On Oct 2"), so a generic title is skipped.
 */
export function shipmentStatusText(s: any): string {
  const st = s?.shipment_status ?? {};
  const title = /^order\s*status$/i.test(clean(st.title)) ? '' : st.title;
  const current = (Array.isArray(s?.tracking_details) ? s.tracking_details : []).filter((x: any) => x?.is_current).slice(-1)[0];
  return clean(st.order_status_text_title || title || String(st.value ?? '').replace(/_/g, ' ') || current?.text || s?.display_status?.header_status || '');
}

function breakup(list: any[] | undefined, name: string): number | undefined {
  return num((list ?? []).find((x) => x?.name === name)?.value);
}

/** The list response carries full shipments, so each entry also comes back as a complete record (`pages`). */
export function parseOrdersJson(json: any): { orders: JioOrderEntry[]; pages: JioOrderPage[]; hasNext: boolean } {
  const items: any[] = json?.items ?? [];
  const pages = items.filter((o) => o?.order_id).map((o) => parseOrderJson(o));
  const orders = items.filter((o) => o?.order_id).map((o) => {
    const shipments: any[] = o.shipments ?? [];
    return {
      orderId: String(o.order_id),
      orderDate: o.order_created_time ? toIsoDate(String(o.order_created_time)).slice(0, 10) : undefined,
      total: breakup(o.breakup_values, 'total'),
      status: shipments.length ? shipmentStatusText(shipments[0]) : undefined,
      shipmentIds: shipments.map((s) => String(s.shipment_id)).filter(Boolean),
    };
  });
  return { orders, pages, hasNext: !!json?.page?.has_next };
}

/** A Fynd order (orders API / order detail) or a single shipment (JioMart details endpoint) → our record. */
export function parseOrderJson(json: any, orderIdHint?: string): JioOrderPage {
  const root = json?.order ?? json?.shipment ?? json;
  const shipments: any[] = root?.shipments ?? (root?.shipment_id ? [root] : []);
  const items: OrderItem[] = [];
  for (const s of shipments) {
    for (const b of s?.bags ?? []) {
      const it = b?.item ?? {};
      items.push({
        productId: it.id != null ? String(it.id) : undefined,
        title: clean(it.name ?? b?.display_name ?? ''),
        qty: Number(b?.quantity ?? 1) || 1,
        unitPrice: num(b?.prices?.price_effective ?? b?.prices?.price_marked),
        seller: clean(s?.fulfilling_store?.name ?? '') || undefined,
        url: it.slug_key ? `/product/${it.slug_key}` : undefined,
      });
    }
  }
  const first = shipments[0] ?? {};
  const statusText = shipmentStatusText(first);
  const steps: any[] = Array.isArray(first?.tracking_details) ? first.tracking_details : [];
  const delivered = /deliver/i.test(statusText) && !/out\s*for/i.test(statusText);
  const deliveredStep = steps.find((x) => /deliver/i.test(x?.text ?? x?.status ?? '') && x?.is_passed);
  const addr = first?.delivery_address ?? {};
  const pay = (root?.payment_info ?? first?.payment_info ?? [])[0] ?? first?.payment ?? {};
  const bv = root?.breakup_values ?? first?.breakup_values;
  const negatives = (bv ?? []).filter((x: any) => Number(x?.value) < 0).reduce((a: number, x: any) => a + Number(x.value), 0);
  const tracking: Tracking | undefined = statusText
    ? {
        status: normalizeStatus(statusText),
        rawStatus: statusText,
        courier: clean(first?.dp_name || first?.dp_details?.name || first?.meta?.delivery_associate_name || '') || undefined,
        awb: clean(first?.awb_no || first?.traking_no || '') || undefined,
        eta: !delivered ? clean(first?.delivery_date ?? first?.promise?.timestamp?.max ?? '') || undefined : undefined,
        deliveredAt: delivered ? clean(deliveredStep?.time ?? first?.delivery_date ?? '') || undefined : undefined,
        events: steps.filter((x) => x?.is_passed).map((x) => ({ at: clean(String(x.time ?? '')), text: clean(x.text ?? x.status ?? '') })),
      }
    : undefined;
  const invoiceTokens: InvoiceToken[] = shipments
    .filter((s) => typeof s?.invoice_url === 'string' && s.invoice_url)
    .map((s) => ({ shipmentId: String(s.shipment_id), token: s.invoice_url, invoiceNo: clean(s.invoice?.store_invoice_id) || String(s.shipment_id) }));
  const created = root?.order_created_time ?? first?.shipment_created_at;
  return {
    detail: {
      platform: 'jiomart',
      orderId: String(root?.order_id ?? first?.order_id ?? orderIdHint ?? ''),
      orderDate: created ? toIsoDate(String(created)).slice(0, 10) : undefined,
      items,
      total: breakup(bv, 'total') ?? num(first?.prices?.amount_paid),
      subtotal: breakup(bv, 'sub_total'),
      discount: negatives ? Math.abs(negatives) : undefined,
      paymentMode: clean(pay.display_name || pay.payment_mode || pay.mode || '') || undefined,
      shipCity: clean(addr.city ?? '') || undefined,
      pincode: addr.pincode ? String(addr.pincode) : undefined,
      invoiceAvailable: invoiceTokens.length > 0 || shipments.some((s) => s?.show_download_invoice),
      tracking,
    },
    shipmentIds: shipments.map((s) => String(s.shipment_id)).filter(Boolean),
    invoiceTokens,
  };
}

export interface JioApiCart extends JioCart {
  cartId: string;
  items: Array<{ productId: string; size: string; articleId: string; identifier: string; index: number; qty: number }>;
  couponMinimum: number | null;
  couponMessage: string;
}

export function parseCartJson(json: any): JioApiCart {
  const items: any[] = json?.items ?? [];
  const raw = json?.breakup_values?.raw ?? {};
  const c = json?.breakup_values?.coupon ?? {};
  const lines = items.map((it) => ({
    productId: String(it?.product?.uid ?? ''),
    title: clean(it?.product?.name ?? ''),
    qty: Number(it?.quantity ?? 0) || 0,
    // "price" is the whole line (qty × unit); "price_per_unit" is one unit.
    unitPrice: num(it?.price_per_unit?.converted?.effective ?? it?.price_per_unit?.base?.effective)
      ?? (() => { const line = num(it?.price?.converted?.effective ?? it?.price?.base?.effective); const q = Number(it?.quantity) || 0; return line != null && q ? Math.round((line / q) * 100) / 100 : null; })(),
  }));
  return {
    cartId: String(json?.id ?? json?.cart_id ?? ''),
    lines,
    subtotal: num(raw.subtotal ?? raw.sub_total) ?? null,
    itemCount: lines.reduce((a, l) => a + l.qty, 0),
    discount: raw.coupon != null && Number(raw.coupon) !== 0 ? Math.abs(Number(raw.coupon)) : null,
    payable: num(raw.total) ?? null,
    couponApplied: c?.is_applied ? clean(c.code) || 'applied' : null,
    couponMinimum: num(c?.minimum_cart_value) ?? null,
    couponMessage: clean(c?.message ?? ''),
    items: items.map((it, index) => ({
      productId: String(it?.product?.uid ?? ''),
      size: String(it?.article?.size ?? ''),
      articleId: String(it?.article?.uid ?? ''),
      identifier: String(it?.identifiers?.identifier ?? ''),
      index,
      qty: Number(it?.quantity ?? 0) || 0,
    })),
  };
}

// ---------- orders: rendered pages (layer C) ----------

export function parseOrderListDom(doc: Document): { orders: JioOrderEntry[]; nextHref: string | null } {
  const text = pageText(doc);
  const out = new Map<string, JioOrderEntry>();
  for (const m of text.matchAll(/order\s*id\s*[-:]\s*([A-Z0-9][A-Z0-9-]{7,})/gi)) {
    if (!out.has(m[1])) out.set(m[1], { orderId: m[1], shipmentIds: [] });
  }
  // Shipment links sit inside each order's accordion; attach them to the nearest preceding order ID.
  const links = Array.from(doc.querySelectorAll(S.orders.shipmentLink));
  for (const a of links) {
    const id = a.getAttribute('href')!.split('/shipment/')[1]?.split(/[?#/]/)[0];
    if (!id) continue;
    const block = a.closest('[class*="accordion"], [class*="order__order"], li, section') ?? a.parentElement;
    const owner = clean(block?.textContent).match(/order\s*id\s*[-:]\s*([A-Z0-9][A-Z0-9-]{7,})/i)?.[1] ?? [...out.keys()].pop();
    if (!owner) continue;
    const e = out.get(owner) ?? { orderId: owner, shipmentIds: [] };
    if (!e.shipmentIds.includes(id)) e.shipmentIds.push(id);
    const status = clean(a.querySelector('[class*="statusBox"], [class*="state"]')?.textContent);
    if (status && !e.status) e.status = status;
    out.set(owner, e);
  }
  return { orders: [...out.values()], nextHref: null };
}

export function parseShipmentDom(doc: Document, orderIdHint?: string): JioOrderPage {
  const text = pageText(doc);
  const orderId = text.match(/order\s*id\s*[:\-]?\s*([A-Z0-9][A-Z0-9-]{7,})/i)?.[1] ?? orderIdHint ?? '';
  const items: OrderItem[] = [];
  for (const sel of S.shipment.item) {
    const cards = Array.from(doc.querySelectorAll(sel));
    for (const c of cards) {
      const title = textOf(c, S.shipment.itemName);
      if (!title) continue;
      items.push({ title, qty: Number(textOf(c, S.shipment.itemQty).match(/(\d+)/)?.[1] ?? 1) || 1, unitPrice: parseInr(textOf(c, S.shipment.itemPrice)) ?? undefined });
    }
    if (items.length) break;
  }
  const statusTitle = textOf(doc, S.shipment.status);
  const events: Tracking['events'] = [];
  for (const sel of S.shipment.timelineItem) {
    doc.querySelectorAll(sel).forEach((el) => {
      const t = textOf(el, S.shipment.timelineTitle) || clean(el.textContent);
      if (t) events.push({ at: textOf(el, S.shipment.timelineDate), text: t });
    });
    if (events.length) break;
  }
  const raw = statusTitle || events[events.length - 1]?.text || '';
  const address = textOf(doc, S.shipment.address);
  const shipmentId = doc.location?.pathname.match(/shipment\/([^/?#]+)/)?.[1];
  const hasInvoice = !!doc.querySelector(S.shipment.invoiceButton.join(', ')) && /invoice/i.test(text);
  const dateText = text.match(/date\s*:\s*([^|\n]+)/i)?.[1] ?? labelled(text, /ordered on|order date|placed on/);
  const total = parseInr(textOf(doc, S.shipment.totalRow).match(/(?:total|amount paid)[^₹\d]*₹?\s*([\d,]+(?:\.\d+)?)/i)?.[1]) ?? parseInr(labelled(text, /amount paid|order total|grand total|total amount/));
  return {
    detail: {
      platform: 'jiomart',
      orderId,
      orderDate: dateText ? toIsoDate(dateText).slice(0, 10) : undefined,
      items,
      total: total ?? undefined,
      paymentMode: textOf(doc, S.shipment.paymentMode) || undefined,
      pincode: address.match(/\b(\d{6})\b/)?.[1],
      shipCity: clean(address.split(',').slice(-2, -1)[0]) || undefined,
      invoiceAvailable: hasInvoice,
      tracking: raw ? { status: normalizeStatus(raw), rawStatus: raw, courier: textOf(doc, S.shipment.partner) || undefined, events } : undefined,
    },
    shipmentIds: shipmentId ? [shipmentId] : [],
    invoiceTokens: [],
  };
}
