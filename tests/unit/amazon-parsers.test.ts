import { describe, it, expect } from 'vitest';
import * as P from '@/adapters/amazon/parsers';
import * as F from '../fixtures/amazon/pages';

const doc = (html: string) => new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html');

describe('amazon parsers', () => {
  it('reads account and page flags', () => {
    expect(P.parseAccount(doc(F.product))?.name).toBe('Badal');
    expect(P.parseAccount(doc(F.signedOut))).toBeNull();
    expect(P.pageFlags(doc(F.signedOut)).signedOut).toBe(true);
    expect(P.pageFlags(doc(F.captcha)).captcha).toBe(true);
    expect(P.pageFlags(doc(F.product)).captcha).toBe(false);
  });

  it('reads a product', () => {
    expect(P.parseProduct(doc(F.product), 'https://www.amazon.in/dp/B0TESTASIN')).toEqual({
      asin: 'B0TESTASIN', title: 'Classmate Notebook 172 pages (Pack of 6)', unitPrice: 499, maxQty: 30, inStock: true, hasCoupon: true,
    });
  });

  it('reads the cart', () => {
    const c = P.parseCart(doc(F.cart));
    expect(c.subtotal).toBe(5609);
    expect(c.itemCount).toBe(12);
    expect(c.lines[0]).toMatchObject({ asin: 'B0TESTASIN', qty: 11, unitPrice: 499 });
  });

  it('reads coupon success and totals on the payment step', () => {
    expect(P.parseCheckout(doc(F.paymentOk))).toMatchObject({ step: 'payment', couponOk: true, discount: 560.9, orderTotal: 5048.1 });
  });

  it('reads a rejected coupon', () => {
    const c = P.parseCheckout(doc(F.paymentBad));
    expect(c.couponOk).toBe(false);
    expect(c.couponMessage).toMatch(/not valid/);
  });

  it('captures order ids from the thank-you page', () => {
    expect(P.parseConfirmation(doc(F.thankYou), 'https://www.amazon.in/gp/buy/thankyou/handlers/display.html'))
      .toEqual(['403-1234567-7654321', '171-1111111-2222222']);
  });

  it('lists orders from cards and from the text fallback, with pagination', () => {
    const { orders, nextHref } = P.parseOrderList(doc(F.orderList));
    expect(orders.map((o) => o.orderId)).toEqual(['403-1234567-7654321', '171-1111111-2222222', '402-9999999-0000001']);
    expect(orders[0]).toMatchObject({ orderDate: '2026-10-01', total: 5048.1 });
    expect(nextHref).toContain('startIndex=10');
  });

  it('reads an order detail page', () => {
    const { detail, trackHrefs, invoiceHref } = P.parseOrderDetail(doc(F.orderDetail), '403-1234567-7654321');
    expect(detail).toMatchObject({
      orderId: '403-1234567-7654321', orderDate: '2026-10-01', total: 5048.1, subtotal: 5609, discount: 560.9,
      paymentMode: 'UPI', pincode: '110001', invoiceAvailable: true,
    });
    expect(detail.items[0]).toMatchObject({ productId: 'B0TESTASIN', qty: 11, seller: 'Cocoblu Retail' });
    expect(detail.tracking?.status).toBe('Ordered');
    expect(trackHrefs).toHaveLength(1);
    expect(invoiceHref).toContain('invoice');
  });

  it('reads tracking', () => {
    const t = P.parseTracking(doc(F.tracking));
    expect(t).toMatchObject({ status: 'Out for delivery', courier: 'Delhivery', awb: '1234567890123', eta: 'Tuesday' });
    expect(t.events[0]).toMatchObject({ text: 'Package arrived at the carrier facility', location: 'Bhiwandi' });
    expect(P.parseTracking(doc(F.trackingDelivered))).toMatchObject({ status: 'Delivered', deliveredAt: '7 October' });
  });

  it('lists invoice PDFs but not the printable summary', () => {
    const refs = P.parseInvoiceLinks(doc(F.invoicePopover), '403-1234567-7654321');
    expect(refs.map((r) => r.invoiceNo)).toEqual(['9f8e7d6c-1111', 'aa11bb22-2222']);
    expect(refs[0].url).toBe('https://www.amazon.in/documents/download/9f8e7d6c-1111/invoice.pdf');
  });
});
