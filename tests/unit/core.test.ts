import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { qtyForTarget, parseInr } from '@/core/qty';
import { normalizeStatus, isFinal } from '@/core/status';
import { orderGaps, completeness } from '@/core/schemas';
import { invoiceKey, isNewInvoice, sha256Hex } from '@/core/dedupe';
import { buildZip, zipDownloadPath, invoiceFileName, safeName } from '@/core/zip';
import { maskPII } from '@/llm/mask';

describe('qtyForTarget', () => {
  it('picks the smallest qty that reaches the target', () => {
    expect(qtyForTarget(499, 5000)).toMatchObject({ qty: 11, subtotal: 5489, shortfall: 0 });
  });
  it('is exact on float-unfriendly prices', () => {
    expect(qtyForTarget(33.33, 99.99)).toMatchObject({ qty: 3, shortfall: 0 });
  });
  it('uses 1 when one unit already exceeds the target', () => {
    expect(qtyForTarget(8000, 5000)).toMatchObject({ qty: 1 });
  });
  it('clamps to the site max and reports the shortfall', () => {
    expect(qtyForTarget(100, 5000, 10)).toMatchObject({ qty: 10, shortfall: 4000, clamped: true });
  });
  it('refuses to guess without a price or stock', () => {
    expect(qtyForTarget(null, 5000)).toEqual({ qty: null, reason: 'no-price' });
    expect(qtyForTarget(100, 5000, 10, false)).toEqual({ qty: null, reason: 'out-of-stock' });
  });
  it('"closest" picks whichever side lands nearer the target', () => {
    expect(qtyForTarget(499, 5000, 999, true, 'closest')).toMatchObject({ qty: 10, subtotal: 4990, shortfall: 10 });
    expect(qtyForTarget(430, 5000, 999, true, 'closest')).toMatchObject({ qty: 12, subtotal: 5160 });
  });
  it('"under" never goes past the target (at least 1)', () => {
    expect(qtyForTarget(499, 5000, 999, true, 'under')).toMatchObject({ qty: 10, subtotal: 4990 });
    expect(qtyForTarget(8000, 5000, 999, true, 'under')).toMatchObject({ qty: 1 });
  });
  it('parses INR text', () => {
    expect(parseInr('₹1,23,456.50')).toBe(123456.5);
    expect(parseInr('Rs. 999')).toBe(999);
    expect(parseInr('—')).toBeNull();
  });
});

describe('normalizeStatus', () => {
  it.each([
    ['Delivered on 12 Oct', 'Delivered'],
    ['Your item has been delivered', 'Delivered'],
    ['Out for delivery', 'Out for delivery'],
    ['Delivery attempt failed', 'Delayed'],
    ['Not delivered', 'Delayed'],
    ['Arriving tomorrow by 9 PM', 'Ordered'],
    ['Shipped', 'Shipped'],
    ['In transit - reached Bhiwandi hub', 'In transit'],
    ['Order Cancelled', 'Cancelled'],
    ['Refund completed', 'Returned'],
    ['Packed', 'Packed'],
    ['Shipping soon', 'Packed'],
    ['', 'Unknown'],
  ])('%s → %s', (raw, want) => expect(normalizeStatus(raw)).toBe(want));

  it('treats delivered/cancelled/returned as final', () => {
    expect(isFinal('Delivered')).toBe(true);
    expect(isFinal('In transit')).toBe(false);
  });
});

describe('completeness', () => {
  const full = {
    platform: 'amazon' as const, orderId: '403-1234567-1234567', orderDate: '2026-10-01', total: 5489,
    items: [{ title: 'Pen', qty: 11 }],
    tracking: { status: 'In transit' as const, rawStatus: 'In transit', courier: 'ATS', awb: '123', eta: '2026-10-12', events: [] },
  };
  it('is 100 when nothing is missing', () => {
    expect(orderGaps(full)).toEqual([]);
    expect(completeness(full)).toBe(100);
  });
  it('lists missing shipped-only fields', () => {
    const o = { ...full, tracking: { ...full.tracking, awb: undefined, courier: '' } };
    expect(orderGaps(o)).toEqual(expect.arrayContaining(['tracking.awb', 'tracking.courier']));
    expect(completeness(o)).toBeLessThan(100);
  });
  it('does not demand AWB before shipping', () => {
    const o = { ...full, tracking: { status: 'Ordered' as const, rawStatus: 'Ordered', events: [] } };
    expect(orderGaps(o)).toEqual([]);
  });
});

describe('invoice dedupe and zip', () => {
  it('rejects a known key or a known hash', () => {
    const known = { keys: new Set([invoiceKey('amazon', 'acc', 'O1', 'INV1')]), hashes: new Set(['h1']) };
    expect(isNewInvoice(known, invoiceKey('amazon', 'acc', 'O1', 'INV1'))).toBe(false);
    expect(isNewInvoice(known, invoiceKey('amazon', 'acc', 'O2', 'INV2'), 'h1')).toBe(false);
    expect(isNewInvoice(known, invoiceKey('amazon', 'acc', 'O2', 'INV2'), 'h2')).toBe(true);
  });
  it('hashes bytes deterministically', async () => {
    const a = await sha256Hex(new TextEncoder().encode('pdf'));
    expect(a).toBe(await sha256Hex(new TextEncoder().encode('pdf')));
    expect(a).toHaveLength(64);
  });
  it('names paths per date and account', () => {
    expect(zipDownloadPath('2026-10-09', 'amazon', 'Badal K')).toBe('OrderPilot/Invoices/Badal_K/2026-10-09_amazon_Badal_K.zip');
    expect(invoiceFileName('amazon', '403-1/2', 'IN:1')).toBe('amazon_403-1_2_IN_1.pdf');
    expect(safeName('')).toBe('unknown');
  });
  it('builds a zip without name collisions', async () => {
    const blob = await buildZip([{ name: 'a.pdf', data: new Uint8Array([1]) }, { name: 'a.pdf', data: new Uint8Array([2]) }]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(['a.pdf', 'a_2.pdf']);
  });
});

describe('maskPII', () => {
  it('masks contact details but keeps order data', () => {
    const t = 'Order ID 403-1234567-1234567\nCall 9876543210 or mail a.b@x.com\nFlat 5, MG Road\nPincode 110001\nTotal ₹5,489';
    const m = maskPII(t);
    expect(m).toContain('403-1234567-1234567');
    expect(m).toContain('[phone]');
    expect(m).toContain('[email]');
    expect(m).toContain('[address line]');
    expect(m).toContain('110001');
    expect(m).toContain('₹5,489');
  });
  it('masks names and the whole address block, keeping city + pincode', () => {
    const t = 'Hello, Badal Kumar\nShipping Address\nBadal Kumar\nGodown 4 Okhla Phase 2\nNEW DELHI, DELHI 110020\nIndia\nDeliver to Ravi Sharma\nTotal ₹999';
    const m = maskPII(t);
    expect(m).not.toContain('Badal');
    expect(m).not.toContain('Okhla');
    expect(m).not.toContain('Ravi');
    expect(m).toContain('NEW DELHI, DELHI 110020');
    expect(m).toContain('₹999');
  });

  it('keeps a 10-digit AWB that looks like a phone number', () => {
    expect(maskPII('AWB: 9876543210')).toBe('AWB: 9876543210');
    expect(maskPII('Tracking ID 7766554433')).toContain('7766554433');
  });
});
