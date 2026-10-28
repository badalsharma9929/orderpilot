import React, { useMemo, useState } from 'react';
import { Button, Card, Empty, SectionTitle, inputCls, when } from '../kit';
import { bg, useLive, useProgress } from '../hooks';
import { db } from '@/db/dexie';
import { localDay } from '@/db/repo';

export function Invoices() {
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(localDay(new Date(Date.now() - 6 * 864e5)));
  const [to, setTo] = useState(localDay());
  const [events] = useProgress('invoices');
  const rows = useLive(() => db.invoices.orderBy('fetchedDay').reverse().toArray(), [], []);
  const accounts = useLive(() => db.accounts.toArray(), [], []);
  const zips = useMemo(() => {
    const m = new Map<string, { name: string; count: number; at?: string }>();
    rows?.forEach((r) => { if (r.zipName) { const z = m.get(r.zipName) ?? { name: r.zipName, count: 0, at: r.zippedAt }; z.count++; m.set(r.zipName, z); } });
    return [...m.values()];
  }, [rows]);
  const nameOf = (id: string) => accounts?.find((a) => a.id === id)?.displayName ?? id;

  async function run(op: 'invoices.run' | 'invoices.zipRange') {
    setBusy(true);
    try { await bg(op === 'invoices.run' ? { op } : { op, from, to }); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <Card>
        <div className="space-y-2 p-3">
          <Button onClick={() => run('invoices.run')} disabled={busy} className="w-full">{busy ? 'Working…' : 'Collect new invoices now'}</Button>
          <p className="text-[11px] text-muted" aria-live="polite">{events[events.length - 1]?.step ?? 'Runs after every status check. Each invoice is downloaded once; duplicates are skipped by number and by file hash.'}</p>
        </div>
        <div className="flex items-end gap-2 border-t border-line p-3">
          <label className="flex-1 text-[11px] text-muted">From<input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="flex-1 text-[11px] text-muted">To<input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <Button variant="ghost" disabled={busy} onClick={() => run('invoices.zipRange')}>Re-zip</Button>
        </div>
      </Card>

      <Card>
        <SectionTitle aside={<span className="text-[11px] text-muted tabular">{zips.length}</span>}>ZIP files</SectionTitle>
        {!zips.length ? <Empty title="No ZIPs yet" body="Saved to Downloads/OrderPilot/Invoices/<account>/ by date." /> : (
          <ul className="divide-y divide-line">
            {zips.map((z) => <li key={z.name} className="px-3 py-2 text-[12px]"><p className="break-all">{z.name.split('/').pop()}</p><p className="text-[11px] text-muted">{z.count} invoice(s) · {when(z.at)}</p></li>)}
          </ul>
        )}
      </Card>

      <Card>
        <SectionTitle aside={<span className="text-[11px] text-muted tabular">{rows?.length ?? 0}</span>}>Invoices</SectionTitle>
        <ul className="divide-y divide-line">
          {rows?.slice(0, 200).map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-2 px-3 py-2 text-[12px]">
              <span className="min-w-0"><span className="font-mono tabular">{r.orderId}</span><span className="block truncate text-[11px] text-muted">{nameOf(r.accountId)} · {r.fetchedDay} · {r.invoiceNo}</span></span>
              <span className="text-[11px] text-muted">{r.zippedAt === 'duplicate' ? 'duplicate skipped' : r.zippedAt ? 'zipped' : 'pending'}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
