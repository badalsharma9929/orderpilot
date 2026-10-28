import { describe, it, expect, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { buildXlsx, colName, sheetName } from '@/core/xlsx';
import { buildReportSheets } from '@/core/report';
import { OrderPilotDB } from '@/db/dexie';
import { saveOrderRead } from '@/db/repo';
import { parseOrdersJson } from '@/adapters/jiomart/parsers';
import * as F from '../fixtures/jiomart/data';

describe('xlsx writer', () => {
  it('names columns like Excel', () => {
    expect([0, 25, 26, 27, 701, 702].map(colName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
    expect(sheetName('Orders: [2026]/x?')).toBe('Orders   2026  x ');
  });

  it('writes a valid workbook with escaped text, numbers and a frozen bold header', async () => {
    const bytes = await buildXlsx([
      { name: 'Orders', columns: ['Order ID', 'Total ₹', 'Note'], rows: [['FY1', 1790, 'A & B <c> "d"'], ['FY2', 0.5, null]] },
      { name: 'Items', columns: ['x'], rows: [] },
    ]);
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']));
    const s1 = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(s1).toContain('<c r="B2"><v>1790</v></c>');
    expect(s1).toContain('A &amp; B &lt;c&gt; &quot;d&quot;');
    expect(s1).toContain('state="frozen"');
    expect(s1).toContain('<autoFilter ref="A1:C3"/>');
    expect(s1).toMatch(/<c r="A1" s="1" t="inlineStr">/);
    const wb = await zip.file('xl/workbook.xml')!.async('string');
    expect(wb).toContain('name="Orders"');
    // Parses as XML
    expect(new DOMParser().parseFromString(s1, 'application/xml').getElementsByTagName('parsererror')).toHaveLength(0);
  });
});

describe('Excel report', () => {
  let db: OrderPilotDB;
  beforeEach(async () => { db = new OrderPilotDB(`r-${Math.random()}`); await db.open(); });

  it('has a row per order and per item with all details', async () => {
    await db.accounts.put({ id: 'jiomart:badal-k', platform: 'jiomart', displayName: 'Badal K', lastSeenAt: '' });
    for (const p of parseOrdersJson(F.ordersPage1).pages) await saveOrderRead({ ...p.detail, shipmentIds: p.shipmentIds }, 'jiomart:badal-k', 'A', { db });
    const [orders, items, tracking, history, invoices] = await buildReportSheets(db);
    expect(orders.rows).toHaveLength(2);
    const row = Object.fromEntries(orders.columns.map((c, i) => [c, orders.rows.find((r) => r[2] === 'FY6ABC1DEF2345678GHI')![i]]));
    expect(row).toMatchObject({ Site: 'jiomart', Account: 'Badal K', 'Order date': '2026-10-01', Status: 'In transit', 'Total ₹': 1790, Payment: 'UPI', City: 'DELHI', Pincode: '110092', 'Total qty': 10 });
    expect(items.rows[0]).toEqual(expect.arrayContaining(['Quickwork A4 Notebook Pack of 5', 10, 199, 1990]));
    expect(tracking.rows.length).toBeGreaterThan(0);
    expect(history.rows).toHaveLength(2);
    expect(invoices.rows).toHaveLength(0);
  });
});
