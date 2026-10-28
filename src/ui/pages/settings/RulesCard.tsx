import React from 'react';
import { Card, Field, SectionTitle, inputCls } from '../../kit';
import { GSTIN_RE, type Settings } from '@/core/settings';
import type { QtyRule } from '@/core/qty';

const num = (v: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));

/** Cart Builder rules, invoice and retry windows: everything a user may want to tune without code. */
export function RulesCard({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  return (
    <Card>
      <SectionTitle>Rules</SectionTitle>
      <div className="grid grid-cols-2 gap-2 px-3 pb-3">
        <Field label="Quantity rule" htmlFor="rule" hint={RULE_HINT[s.qtyRule]}>
          <select id="rule" className={inputCls} value={s.qtyRule} onChange={(e) => set({ qtyRule: e.target.value as QtyRule })}>
            <option value="reach">Reach the target</option>
            <option value="closest">Closest to target</option>
            <option value="under">Stay under target</option>
          </select>
        </Field>
        <Field label="My max qty per order" htmlFor="cap" hint="0 = only the site's own limit">
          <input id="cap" type="number" min={0} max={999} className={inputCls} value={s.maxQtyCap} onChange={(e) => set({ maxQtyCap: num(e.target.value, 0, 999) })} />
        </Field>
        <Field label="Raise attempts if short" htmlFor="raise" hint="Extra units tried when the price moved">
          <input id="raise" type="number" min={0} max={5} className={inputCls} value={s.raiseAttempts} onChange={(e) => set({ raiseAttempts: num(e.target.value, 0, 5) })} />
        </Field>
        <Field label="Re-check incomplete orders" htmlFor="retry" hint="Days to keep filling missing fields">
          <input id="retry" type="number" min={1} max={365} className={inputCls} value={s.retryIncompleteDays} onChange={(e) => set({ retryIncompleteDays: num(e.target.value, 1, 365) })} />
        </Field>
        <Field label="GSTIN for GST invoice (JioMart)" htmlFor="gstin" hint={s.gstin && !GSTIN_RE.test(s.gstin) ? 'Check the GSTIN — 15 characters like 07ABCDE1234F1Z5' : 'Ticks "GST Invoice" in the cart · empty = off'}>
          <input id="gstin" className={inputCls + ' uppercase'} maxLength={15} placeholder="07ABCDE1234F1Z5" value={s.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '') })} />
        </Field>
        <Field label="Invoice folder (in Downloads)" htmlFor="folder">
          <input id="folder" className={inputCls} value={s.invoiceFolder} onChange={(e) => set({ invoiceFolder: e.target.value })} />
        </Field>
        <Field label="Excel report folder (in Downloads)" htmlFor="rfolder" hint="Saved after every check">
          <div className="flex items-center gap-2">
            <input aria-label="Save Excel after each check" type="checkbox" checked={s.autoExcel} onChange={(e) => set({ autoExcel: e.target.checked })} />
            <input id="rfolder" className={inputCls} disabled={!s.autoExcel} value={s.reportFolder} onChange={(e) => set({ reportFolder: e.target.value })} />
          </div>
        </Field>
        <Field label="Collect invoices for orders from the last" htmlFor="lookback" hint="days · 0 = all orders">
          <input id="lookback" type="number" min={0} max={3650} className={inputCls} value={s.invoiceLookbackDays} onChange={(e) => set({ invoiceLookbackDays: num(e.target.value, 0, 3650) })} />
        </Field>
      </div>
    </Card>
  );
}

const RULE_HINT: Record<QtyRule, string> = {
  reach: 'Smallest quantity at or above the target (meets coupon minimums)',
  closest: 'Whichever quantity lands nearest the target',
  under: 'Largest quantity that stays at or below the target',
};
