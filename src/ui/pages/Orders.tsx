import React, { useMemo, useState } from 'react';
import { Button, Card, Empty, PlatformTag, SectionTitle, StatusChip, inputCls, inr, pretty, when, cx } from '../kit';
import { bg, useLive, useProgress } from '../hooks';
import { db, type OrderRow } from '@/db/dexie';
import { STATUSES } from '@/core/status';
import { OrderTimeline } from './OrderTimeline';

export function Orders() {
  const [platform, setPlatform] = useState('all');
  const [account, setAccount] = useState('all');
  const [status, setStatus] = useState('open');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [note, setNote] = useState('');
  const [events] = useProgress('sweep');
  const orders = useLive(() => db.orders.orderBy('orderDate').reverse().toArray(), [], []);
  const accounts = useLive(() => db.accounts.toArray(), [], []);
  const lastEvent = events[events.length - 1];

  const rows = useMemo(() => (orders ?? []).filter((o) =>
    (platform === 'all' || o.platform === platform) &&
    (account === 'all' || o.accountId === account) &&
    (status === 'all' || (status === 'open' ? !o.isFinal : status === 'incomplete' ? o.completeness < 100 : o.status === status)) &&
    (!q || o.orderId.includes(q) || o.detail.items.some((i) => i.title.toLowerCase().includes(q.toLowerCase()))),
  ), [orders, platform, account, status, q]);

  if (selected) return <OrderTimeline orderKey={selected} onBack={() => setSelected(null)} />;

  async function exportExcel() {
    setExporting(true);
    try {
      const r = await bg<{ ok: boolean; filename?: string; error?: string }>({ op: 'report.export' });
      setNote(r.ok ? `Saved to Downloads/${r.filename}` : `Excel not saved: ${r.error}`);
    } finally { setExporting(false); }
  }

  async function sweep() {
    setSweeping(true);
    try { await bg({ op: 'sweep.run' }); } finally { setSweeping(false); }
  }

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-center gap-2 p-3">
          <Button onClick={sweep} disabled={sweeping}>{sweeping ? 'Checking…' : 'Check status now'}</Button>
          <Button variant="ghost" disabled={exporting || !orders?.length} onClick={exportExcel}>{exporting ? 'Saving…' : 'Export Excel'}</Button>
          <p className="min-w-0 flex-1 truncate text-[11px] text-muted" aria-live="polite">{sweeping && lastEvent ? lastEvent.step : note || 'Runs daily at the time set in Settings'}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 px-3 pb-3">
          <select aria-label="Platform" className={inputCls} value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <option value="all">All sites</option><option value="amazon">Amazon</option><option value="flipkart">Flipkart</option><option value="jiomart">JioMart</option>
          </select>
          <select aria-label="Account" className={inputCls} value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="all">All accounts</option>
            {accounts?.map((a) => <option key={a.id} value={a.id}>{a.displayName} · {a.platform}</option>)}
          </select>
          <select aria-label="Status" className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="open">Open</option><option value="all">All statuses</option><option value="incomplete">Missing details</option>
            {STATUSES.filter((s) => s !== 'Unknown').map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input aria-label="Search orders" className={inputCls} placeholder="Order ID or item" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </Card>

      <Card>
        <SectionTitle aside={<span className="text-[11px] text-muted tabular">{rows.length}</span>}>Orders</SectionTitle>
        {rows.length === 0 ? (
          <Empty title="No orders here" body={orders?.length ? 'Change the filters to see more.' : 'Place an order or press "Check status now" while signed in to Amazon.'} />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((o) => <OrderItem key={o.key} o={o} onOpen={() => setSelected(o.key)} />)}
          </ul>
        )}
      </Card>
    </div>
  );
}

function OrderItem({ o, onOpen }: { o: OrderRow; onOpen: () => void }) {
  const first = o.detail.items[0];
  const t = o.detail.tracking;
  return (
    <li>
      <button onClick={onOpen} className="w-full px-3 py-2.5 text-left hover:bg-raised">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[12px] tabular">{o.orderId}</span>
          <StatusChip status={o.status} />
        </div>
        <p className="mt-0.5 truncate text-[12px]">{first ? `${first.qty} × ${first.title}` : 'Details pending'}{o.detail.items.length > 1 ? ` +${o.detail.items.length - 1}` : ''}</p>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
          <PlatformTag platform={o.platform} />
          <span>{o.orderDate ?? '—'}</span>
          <span className="tabular">{inr(o.detail.total)}</span>
          {t?.eta && !o.isFinal && <span>ETA {pretty(t.eta)}</span>}
          {o.completeness < 100 && <span className={cx('ml-auto text-warn')} title={`Missing: ${o.gaps.join(', ')}`}>{o.completeness}% complete</span>}
        </div>
        <p className="sr-only">Last checked {when(o.lastCheckedAt)}</p>
      </button>
    </li>
  );
}
