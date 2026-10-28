import React from 'react';
import { Button, Card, PlatformTag, SectionTitle, StatusChip, inr, pretty, when } from '../kit';
import { useLive } from '../hooks';
import { db } from '@/db/dexie';

export function OrderTimeline({ orderKey, onBack }: { orderKey: string; onBack: () => void }) {
  const o = useLive(() => db.orders.get(orderKey), [orderKey]);
  const events = useLive(() => db.statusEvents.where('orderKey').equals(orderKey).sortBy('at'), [orderKey], []);
  const days = useLive(() => db.dailySnapshots.where('orderKey').equals(orderKey).toArray(), [orderKey], []);
  const invoices = useLive(() => db.invoices.where('orderKey').equals(orderKey).toArray(), [orderKey], []);
  const account = useLive(async () => (o ? db.accounts.get(o.accountId) : undefined), [o?.accountId]);
  if (!o) return null;
  const d = o.detail;
  const t = d.tracking;

  return (
    <div className="space-y-3">
      <Button variant="ghost" onClick={onBack}>← All orders</Button>
      <Card>
        <div className="space-y-1 p-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[13px] tabular">{o.orderId}</span>
            <StatusChip status={o.status} />
          </div>
          <p className="text-[11px] text-muted"><PlatformTag platform={o.platform} /> · {account?.displayName ?? o.accountId.split(':')[1]} · ordered {o.orderDate ?? '—'} · checked {when(o.lastCheckedAt)}</p>
          {o.gaps.length > 0 && <p className="text-[11px] text-warn">Missing: {o.gaps.join(', ')} — retried on every check</p>}
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line p-3 text-[12px]">
          <Info k="Total" v={inr(d.total)} />
          <Info k="Savings" v={d.discount ? `−${inr(d.discount)}` : '—'} />
          <Info k="Payment" v={d.paymentMode ?? '—'} />
          <Info k="Deliver to" v={[d.shipCity, d.pincode].filter(Boolean).join(' ') || '—'} />
          <Info k="Courier" v={t?.courier ?? '—'} />
          <Info k="Tracking ID" v={t?.awb ?? '—'} mono />
          <Info k={o.status === 'Delivered' ? 'Delivered' : 'Expected'} v={pretty(o.status === 'Delivered' ? t?.deliveredAt : t?.eta)} />
          <Info k="Invoices" v={invoices?.length ? `${invoices.length} saved` : d.invoiceAvailable ? 'available' : '—'} />
        </dl>
      </Card>

      <Card>
        <SectionTitle>Items</SectionTitle>
        <ul className="divide-y divide-line">
          {d.items.map((i, n) => (
            <li key={n} className="flex justify-between gap-2 px-3 py-2 text-[12px]">
              <span className="min-w-0 flex-1">{i.title}{i.seller && <span className="block text-[11px] text-muted">{i.seller}</span>}</span>
              <span className="tabular text-muted">{i.qty} × {inr(i.unitPrice)}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <SectionTitle>Status history</SectionTitle>
        <ol className="relative mx-3 mb-3 border-l border-line">
          {events?.slice().reverse().map((e) => (
            <li key={e.id} className="ml-3 pb-3">
              <span aria-hidden className="absolute -left-[4px] mt-1.5 h-2 w-2 rounded-full bg-brand" />
              <div className="flex items-center gap-2"><StatusChip status={e.status} /><span className="text-[11px] text-muted">{when(e.at)}</span><span className="ml-auto rounded bg-line/60 px-1 text-[10px] text-muted" title="Layer that read it">{e.source}</span></div>
              <p className="mt-0.5 text-[12px] text-muted">{e.rawStatus}{e.location ? ` · ${e.location}` : ''}</p>
            </li>
          ))}
        </ol>
      </Card>

      {!!t?.events?.length && (
        <Card>
          <SectionTitle>Tracking steps</SectionTitle>
          <ul className="divide-y divide-line">
            {t.events.map((e, i) => <li key={i} className="px-3 py-1.5 text-[12px]"><span className="text-muted">{pretty(e.at)}</span> · {e.text}{e.location ? ` · ${e.location}` : ''}</li>)}
          </ul>
        </Card>
      )}

      <p className="px-1 text-[11px] text-muted">{days?.length ?? 0} daily snapshot(s) stored.</p>
    </div>
  );
}

function Info({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] text-muted">{k}</dt>
      <dd className={mono ? 'font-mono tabular break-all' : 'break-words'}>{v}</dd>
    </div>
  );
}
