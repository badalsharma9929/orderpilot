import { describe, it, expect } from 'vitest';
import * as P from '@/adapters/jiomart/parsers';
import * as F from '../fixtures/jiomart/data';
import { orderGaps } from '@/core/schemas';

const doc = (html: string, url = 'https://www.jiomart.com/') => {
  const d = new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html');
  return d;
};
const SLUG = 'quickwork-a4-notebook-7527060';
const URL_ = `https://www.jiomart.com/product/${SLUG}`;

describe('jiomart page parsers', () => {
  it('reads the product: price without the struck-through MRP, max qty, stock', () => {
    expect(P.parseProduct(doc(F.productPage(SLUG)), URL_)).toEqual({
      productId: '7527060', slug: SLUG, title: 'Quickwork A4 Notebook Pack of 5', unitPrice: 199, maxQty: 12, inStock: true,
    });
  });

  it('reads the price beside the title, not an offer or EMI price box earlier on the page (live bug)', () => {
    const html = `
      <div class="offers"><div class="PriceContainer__priceContainer"><span class="PriceContainer__currentPrice">₹1,399</span></div></div>
      <div class="product-description__productInfoContent">
        <div><h1 class="product-description__productTitle">Apple iPhone 17 256 GB, White</h1></div>
        <div class="PriceContainer__priceContainer"><span class="PriceContainer__currentPrice">₹99,900</span><span class="PriceContainer__originalPrice">₹1,02,900</span></div>
      </div>
      <button class="product-description__addToCartButton">Add to Cart</button>`;
    expect(P.parseProduct(doc(html), 'https://www.jiomart.com/product/apple-iphone-17-256-gb-white-123').unitPrice).toBe(99900);
  });

  it('cart API: unit price = price_per_unit, or line price ÷ qty', () => {
    const c = P.parseCartJson({ id: 'c', items: [{ product: { uid: 1, name: 'iPhone' }, quantity: 2, price: { converted: { effective: 199800 } }, article: {}, identifiers: {} }], breakup_values: { raw: { subtotal: 199800 } } });
    expect(c.lines[0].unitPrice).toBe(99900);
    const d = P.parseCartJson({ id: 'c', items: [{ product: { uid: 1, name: 'iPhone' }, quantity: 2, price_per_unit: { converted: { effective: 99900 } }, price: { converted: { effective: 199800 } }, article: {}, identifiers: {} }], breakup_values: { raw: {} } });
    expect(d.lines[0].unitPrice).toBe(99900);
  });

  it('never marks a page signed-out from the stale APP_DATA snapshot', () => {
    expect(P.pageFlags(doc(F.productPage(SLUG)), URL_).signedOut).toBe(false);
    expect(P.pageFlags(doc(''), 'https://www.jiomart.com/auth/login?redirectUrl=/cart/bag').signedOut).toBe(true);
  });

  it('reads the rendered cart and summary', () => {
    const c = P.parseCart(doc(F.cartPageDom));
    expect(c.lines[0]).toMatchObject({ productId: '7527060', qty: 10 });
    expect(c).toMatchObject({ subtotal: 1990, discount: 200, payable: 1790 });
  });

  it('captures the order ID on the order-status page', () => {
    expect(P.parseConfirmation(doc(F.orderStatusPage), 'https://www.jiomart.com/cart/order-status?success=true')).toEqual(['FY6NEW0000111122223333']);
    expect(P.parseConfirmation(doc(F.orderStatusPage), 'https://www.jiomart.com/cart/bag')).toEqual([]);
  });
});

describe('jiomart API parsers (verified shapes)', () => {
  it('lists orders with full records from one call', () => {
    const r = P.parseOrdersJson(F.ordersPage1);
    expect(r.hasNext).toBe(false);
    expect(r.orders.map((o) => [o.orderId, o.status, o.total, o.orderDate])).toEqual([
      ['FY6ABC1DEF2345678GHI', 'In Transit', 1790, '2026-10-01'],
      ['FY6ZZZ9YYY8888777XXX', 'Delivered', 1990, '2026-09-20'],
    ]);
    const open = r.pages[0].detail;
    expect(open).toMatchObject({ total: 1790, subtotal: 1990, paymentMode: 'UPI', shipCity: 'DELHI', pincode: '110092' });
    expect(open.items[0]).toMatchObject({ productId: '7527060', qty: 10, unitPrice: 199 });
    expect(open.tracking).toMatchObject({ status: 'In transit', eta: '2026-10-11T12:00:00+05:30' });
    expect(open.tracking?.events.map((e) => e.text)).toEqual(['Processing', 'Confirmed', 'In Transit']);
  });

  it('reads JioMart shipment details: generic title skipped, invoice token kept', () => {
    const p = P.parseOrderJson(F.hellcatDetails('6ABD5BBB0121SHIPDONE02', 'FY6ZZZ9YYY8888777XXX', true));
    expect(p.detail.tracking).toMatchObject({ status: 'Delivered', rawStatus: 'Delivered On Oct 4' });
    expect(p.detail.orderId).toBe('FY6ZZZ9YYY8888777XXX');
    expect(p.invoiceTokens).toEqual([{ shipmentId: '6ABD5BBB0121SHIPDONE02', token: 'TOKEN6ABD5BBB0121SHIPDONE02abcdef0123456789', invoiceNo: 'JMINVNE02' }]);
  });

  it('does not demand a courier or AWB for JioMart (own fleet)', () => {
    const p = P.parseOrdersJson(F.ordersPage1).pages[1].detail;
    expect(orderGaps(p)).toEqual([]);
  });

  it('reads the cart API with coupon state and update identifiers', () => {
    const c = P.parseCartJson(F.cartJson(10, true));
    expect(c).toMatchObject({ cartId: 'cart-123', subtotal: 1990, payable: 1790, discount: 200, couponApplied: 'JMSAVE200', couponMinimum: 1500 });
    expect(c.items[0]).toEqual({ productId: '7527060', size: 'OS', articleId: 'art-1', identifier: 'ident-1', index: 0, qty: 10 });
  });

  it('reads the session user', () => {
    expect(P.parseSessionJson(F.session)).toEqual({ name: 'Badal K', business: false });
  });
});
