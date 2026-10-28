import React, { useEffect, useState } from 'react';
import { CartBuilder } from './pages/CartBuilder';
import { Orders } from './pages/Orders';
import { DailyLog } from './pages/DailyLog';
import { Invoices } from './pages/Invoices';
import { SettingsPage } from './pages/Settings';
import { useLive, useSettings } from './hooks';
import { db } from '@/db/dexie';
import { cx } from './kit';

const TABS = [
  { id: 'cart', label: 'Cart' },
  { id: 'orders', label: 'Orders' },
  { id: 'log', label: 'Daily log' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'settings', label: 'Settings' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function App() {
  const [tab, setTab] = useState<TabId>(() => (localStorage.getItem('tab') as TabId) || 'cart');
  const settings = useSettings();
  const openCount = useLive(() => db.orders.where('isFinal').equals(0).count(), [], 0);
  const issues = useLive(() => db.errors.where('resolved').equals(0).count(), [], 0);

  useEffect(() => { try { localStorage.setItem('tab', tab); } catch {} }, [tab]);
  useEffect(() => {
    const t = settings?.theme ?? 'system';
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }, [settings?.theme]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-line bg-surface px-3 h-11">
        <h1 className="text-[14px] font-semibold tracking-tight">OrderPilot</h1>
        <span className="text-[11px] text-muted tabular">{openCount ?? 0} open{issues ? ` · ${issues} need attention` : ''}</span>
      </header>
      <nav role="tablist" aria-label="Sections" className="flex gap-1 border-b border-line bg-surface px-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              'relative px-2.5 py-2 text-[12px] font-medium transition-colors',
              tab === t.id ? 'text-ink after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:bg-brand' : 'text-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main role="tabpanel" className="flex-1 overflow-y-auto p-3">
        {tab === 'cart' && <CartBuilder />}
        {tab === 'orders' && <Orders />}
        {tab === 'log' && <DailyLog />}
        {tab === 'invoices' && <Invoices />}
        {tab === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
