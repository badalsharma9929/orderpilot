import React, { useMemo, useState } from 'react';
import { Button, Card, Empty, SectionTitle, StatusChip, inputCls, inr } from '../kit';
import { useLive } from '../hooks';
import { db, type DailySnapshotRow } from '@/db/dexie';
import { localDay } from '@/db/repo';

export function DailyLog() {
  const [day, setDay] = useState(localDay());
  const days = useLive(async () => [...new Set((await db.dailySnapshots.orderBy('day').reverse().keys()) as unknown as string[])].slice(0, 120), [], []);
  const rows = useLive(() => db.dailySnapshots.where('day').equals(day).toArray(), [day], []);
  const summary = useMemo(() => {
    const m = new Map<string, number>();
    rows?.forEach((r) => m.set(r.status, (m.get(r.status) ?? 0) + 1));
    return [...m.entries()];
  }, [rows]);

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-center gap-2 p-3">
          <select aria-label="Day" className={inputCls} value={day} onChange={(e) => setDay(e.target.value)}>
            {[...new Set([localDay(), ...(days ?? [])])].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <Button variant="ghost" disabled={!rows?.length} onClick={() => exportCsv(day, rows ?? [])}>Export CSV</Button>
        </div>
        {!!summary.length && (
          <div className="flex flex-wrap gap-1.5 px-3 pb-3">
            {summary.map(([s, n]) => <span key={s} className="inline-flex items-center gap-1"><StatusChip status={s as any} /><span className="text-[11px] tabular text-muted">{n}</span></span>)}
          </div>
        )}
      </Card>
      <Card>
        <SectionTitle>Snapshot · {day}</SectionTitle>
        {!rows?.length ? <Empty title="Nothing recorded this day" body="Each status check saves every order's full details here, one row per order per day." /> : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.orderKey} className="px-3 py-2">
                <div className="flex items-center justify-between"><span className="font-mono text-[12px] tabular">{r.snapshot.orderId}</span><StatusChip status={r.status} /></div>
                <p className="text-[11px] text-muted">{r.platform} · {r.accountId.split(':')[1]} · {inr(r.snapshot.total)} · {r.snapshot.tracking?.courier ?? '—'} {r.snapshot.tracking?.awb ?? ''}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

function exportCsv(day: string, rows: DailySnapshotRow[]) {
  const head = ['day', 'platform', 'account', 'order_id', 'order_date', 'status', 'raw_status', 'courier', 'awb', 'eta', 'delivered_at', 'total', 'subtotal', 'discount', 'payment', 'city', 'pincode', 'items', 'last_event'];
  const lines = rows.map((r) => {
    const s = r.snapshot, t = s.tracking;
    return [day, r.platform, r.accountId, s.orderId, s.orderDate, r.status, t?.rawStatus, t?.courier, t?.awb, t?.eta, t?.deliveredAt, s.total, s.subtotal, s.discount, s.paymentMode, s.shipCity, s.pincode,
      s.items.map((i) => `${i.qty}x ${i.title}`).join(' | '), t?.events?.[0] ? `${t.events[0].at} ${t.events[0].text}` : ''].map(esc).join(',');
  });
  const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `orderpilot-daily-${day}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
