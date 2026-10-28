import React, { useEffect, useState } from 'react';
import { Button, Card, Field, SectionTitle, inputCls, inr, when, cx } from '../kit';
import { bg, useLive, useProgress } from '../hooks';
import { db, type CartRunRow } from '@/db/dexie';
import { platformOfUrl } from '@/adapters/registry';

export function CartBuilder() {
  const [url, setUrl] = useState('');
  const last = readLast();
  const [coupon, setCoupon] = useState(last.coupon ?? '');
  const [target, setTarget] = useState(last.target ?? '');
  const [qty, setQty] = useState(last.qty ?? '');
  const [running, setRunning] = useState(false);
  const [events, clear] = useProgress('cart');
  const history = useLive(() => db.cartRuns.orderBy('at').reverse().limit(5).toArray(), [], []);

  // Prefill the link from the tab the user is looking at.
  useEffect(() => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([t]) => {
      if (t?.url && platformOfUrl(t.url)) setUrl((u) => u || t.url!);
    });
  }, []);

  const platform = platformOfUrl(url);
  const targetNum = Number(target);
  const valid = !!platform && (targetNum > 0 || Number(qty) > 0);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    clear();
    setRunning(true);
    try { localStorage.setItem('cart:last', JSON.stringify({ coupon, target, qty })); } catch {}
    try {
      await bg({ op: 'cart.run', input: { url: url.trim(), coupon: coupon.trim() || undefined, target: targetNum || 0, qty: Number(qty) || undefined } });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-3">
      <Card>
        <SectionTitle>Build cart</SectionTitle>
        <form onSubmit={run} className="space-y-3 px-3 pb-3">
          <Field label="Product link" htmlFor="url" hint={url && !platform ? 'Use an Amazon.in, Flipkart or JioMart product link' : undefined}>
            <input id="url" className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Amazon /dp/… or JioMart /product/… link" required />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Target cart value (₹)" htmlFor="target">
              <input id="target" inputMode="decimal" className={cx(inputCls, 'tabular')} value={target} onChange={(e) => setTarget(e.target.value.replace(/[^\d.]/g, ''))} placeholder="5000" />
            </Field>
            <Field label="Quantity (optional)" htmlFor="qty">
              <input id="qty" inputMode="numeric" className={cx(inputCls, 'tabular')} value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} placeholder="auto" />
            </Field>
          </div>
          <Field label="Coupon code (optional)" htmlFor="coupon">
            <input id="coupon" className={cx(inputCls, 'uppercase')} value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="SAVE10" />
          </Field>
          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={!valid || running} className="flex-1">{running ? 'Working…' : 'Add to cart & apply coupon'}</Button>
            {running && <Button type="button" variant="ghost" onClick={() => bg({ op: 'cart.cancel' })}>Stop</Button>}
          </div>
          <p className="text-[11px] text-muted">{platform === 'jiomart'
            ? 'JioMart: sets the quantity (up to its per-order limit), applies the coupon in the cart and stops there. You pay yourself.'
            : 'Stops at the cart or payment page. You always pay yourself.'}</p>
        </form>
      </Card>

      {events.length > 0 && (
        <Card>
          <SectionTitle>Progress</SectionTitle>
          <ol className="space-y-1 px-3 pb-3" aria-live="polite">
            {events.filter((e) => e.step !== 'done').map((e, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px]">
                <span aria-hidden className={cx('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', e.ok === false ? 'bg-bad' : 'bg-good')} />
                <span className={cx('flex-1', e.ok === false && 'text-bad')}>
                  {e.step}
                  {e.note && <span className="block text-[11px] text-muted break-all">{e.note}</span>}
                </span>
                {e.layer && <span className="rounded bg-line/60 px-1 text-[10px] font-semibold text-muted" title="Layer that succeeded">{e.layer}</span>}
              </li>
            ))}
          </ol>
        </Card>
      )}

      {!!history?.length && (
        <Card>
          <SectionTitle>Recent runs</SectionTitle>
          <ul className="divide-y divide-line">
            {history.map((r) => <RunRow key={r.id} r={r} />)}
          </ul>
        </Card>
      )}
    </div>
  );
}

function readLast(): { coupon?: string; target?: string; qty?: string } {
  try { return JSON.parse(localStorage.getItem('cart:last') ?? '{}'); } catch { return {}; }
}

function RunRow({ r }: { r: CartRunRow }) {
  const label = { 'ready-to-pay': 'Ready to pay', failed: 'Failed', blocked: 'Blocked', 'needs-you': 'Needs you' }[r.outcome];
  return (
    <li className="flex items-center justify-between gap-2 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-[12px]">{r.qty ? `${r.qty} × ` : ''}{inr(r.unitPrice)} · {r.coupon ?? 'no coupon'}</p>
        <p className="text-[11px] text-muted">{when(r.at)} · subtotal {inr(r.subtotal)}{r.discount ? ` · −${inr(r.discount)}` : ''}</p>
      </div>
      <span className={cx('text-[11px] font-medium', r.outcome === 'ready-to-pay' ? 'text-good' : 'text-bad')}>{label}</span>
    </li>
  );
}
