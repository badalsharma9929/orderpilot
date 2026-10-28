import React, { useState } from 'react';
import { Button, Card, Field, SectionTitle, inputCls, when } from '../kit';
import { bg, useLive, useSettings } from '../hooks';
import { saveSettings, type Settings } from '@/core/settings';
import { db } from '@/db/dexie';
import { RulesCard } from './settings/RulesCard';
import { SelectorEditor } from './settings/SelectorEditor';

export function SettingsPage() {
  const s = useSettings();
  const errors = useLive(() => db.errors.where('resolved').equals(0).reverse().sortBy('at'), [], []);
  const ladder = useLive(() => db.ladderStats.toArray(), [], []);
  const [keyDraft, setKeyDraft] = useState('');
  if (!s) return null;

  const set = async (patch: Partial<Settings>) => {
    await saveSettings(patch);
    if ('sweepTime' in patch || 'eveningSweep' in patch || 'eveningTime' in patch) await bg({ op: 'alarms.reschedule' });
  };

  return (
    <div className="space-y-3">
      <Card>
        <SectionTitle>Daily status check</SectionTitle>
        <div className="grid grid-cols-2 gap-2 px-3 pb-3">
          <Field label="Morning check" htmlFor="t1"><input id="t1" type="time" className={inputCls} value={s.sweepTime} onChange={(e) => set({ sweepTime: e.target.value })} /></Field>
          <Field label="Evening check" htmlFor="t2">
            <div className="flex items-center gap-2">
              <input aria-label="Enable evening check" type="checkbox" checked={s.eveningSweep} onChange={(e) => set({ eveningSweep: e.target.checked })} />
              <input id="t2" type="time" className={inputCls} disabled={!s.eveningSweep} value={s.eveningTime} onChange={(e) => set({ eveningTime: e.target.value })} />
            </div>
          </Field>
          <Field label="Look back for orders" htmlFor="months">
            <select id="months" className={inputCls} value={s.discoveryMonths} onChange={(e) => set({ discoveryMonths: Number(e.target.value) as 0 | 3 | 6 | 12 })}>
              <option value={0}>All orders (full history)</option>
              <option value={3}>3 months</option><option value={6}>6 months</option><option value={12}>12 months</option>
            </select>
          </Field>
          <Field label="Parallel requests per site" htmlFor="conc" hint="Slows down automatically if a site pushes back">
            <input id="conc" type="number" min={1} max={12} className={inputCls} value={s.concurrency.amazon}
              onChange={(e) => { const n = Math.min(12, Math.max(1, Number(e.target.value) || 1)); set({ concurrency: { amazon: n, flipkart: n, jiomart: n } }); }} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-4 px-3 pb-2 text-[12px]">
          <span className="text-muted">Sites to check:</span>
          {(['amazon', 'jiomart'] as const).map((p) => (
            <label key={p} className="flex items-center gap-2 capitalize">
              <input type="checkbox" checked={s.sites.includes(p)}
                onChange={(e) => set({ sites: e.target.checked ? [...new Set([...s.sites, p])] : s.sites.filter((x) => x !== p) })} />
              {p === 'jiomart' ? 'JioMart' : 'Amazon'}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-4 px-3 pb-3 text-[12px]">
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.autoInvoices} onChange={(e) => set({ autoInvoices: e.target.checked })} />Collect invoices after each check</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.notify} onChange={(e) => set({ notify: e.target.checked })} />Notifications</label>
        </div>
      </Card>

      <RulesCard s={s} set={set} />

      <Card>
        <SectionTitle>AI fallback (layer D)</SectionTitle>
        <div className="space-y-2 px-3 pb-3">
          <p className="text-[11px] text-muted">Used only when selectors and text matching fail. Page text is sent to Anthropic with phone numbers, emails and address lines masked. The key stays on this computer.</p>
          <Field label={s.claudeApiKey ? 'Claude API key (saved)' : 'Claude API key'} htmlFor="key">
            <div className="flex gap-2">
              <input id="key" type="password" autoComplete="off" className={inputCls} placeholder={s.claudeApiKey ? '••••••••' : 'sk-ant-…'} value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} />
              <Button variant="ghost" disabled={!keyDraft} onClick={async () => { await set({ claudeApiKey: keyDraft.trim() }); setKeyDraft(''); }}>Save</Button>
              {s.claudeApiKey && <Button variant="danger" onClick={() => set({ claudeApiKey: '' })}>Remove</Button>}
            </div>
          </Field>
          <Field label="Claude model" htmlFor="model" hint="Haiku is fastest and cheapest; Sonnet/Opus read harder pages better">
            <select id="model" className={inputCls} value={s.claudeModel} onChange={(e) => set({ claudeModel: e.target.value })}>
              <option value="claude-haiku-5-5">Claude Haiku 5.5</option>
              <option value="claude-sonnet-5-5">Claude Sonnet 5.5</option>
              <option value="claude-opus-5-5">Claude Opus 5.5</option>
            </select>
          </Field>
        </div>
      </Card>

      <Card>
        <SectionTitle>Appearance</SectionTitle>
        <div className="flex gap-2 px-3 pb-3">
          {(['system', 'light', 'dark'] as const).map((t) => <Button key={t} variant={s.theme === t ? 'primary' : 'ghost'} onClick={() => set({ theme: t })} className="capitalize">{t}</Button>)}
        </div>
      </Card>

      <Card>
        <SectionTitle aside={!!errors?.length && <Button variant="ghost" onClick={() => db.errors.where('resolved').equals(0).modify({ resolved: 1 })}>Clear</Button>}>Needs attention</SectionTitle>
        {!errors?.length ? <p className="px-3 pb-3 text-[12px] text-muted">Nothing outstanding.</p> : (
          <ul className="divide-y divide-line">
            {errors.slice(0, 50).map((e) => <li key={e.id} className="px-3 py-2 text-[12px]"><span className="font-medium">{e.kind}</span> · <span className="text-muted">{when(e.at)}</span><p className="break-words text-[11px] text-muted">{e.message}</p></li>)}
          </ul>
        )}
      </Card>

      <SelectorEditor s={s} set={set} />

      <Card>
        <SectionTitle>Tools</SectionTitle>
        <div className="space-y-2 px-3 pb-3">
          <Button variant="ghost" onClick={() => bg({ op: 'page.save' })}>Save this page for tuning</Button>
          <p className="text-[11px] text-muted">Saves the open shop page to Downloads/OrderPilot/pages so selectors can be matched to your real pages.</p>
          {!!ladder?.length && (
            <details className="text-[11px] text-muted">
              <summary className="cursor-pointer">Fastest working layer per step</summary>
              <ul className="mt-1 space-y-0.5">{ladder.map((l) => <li key={l.key} className="font-mono">{l.key} → {l.winner}</li>)}</ul>
            </details>
          )}
        </div>
      </Card>
    </div>
  );
}
