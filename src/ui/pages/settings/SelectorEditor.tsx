import React, { useMemo, useState } from 'react';
import { Button, Card, SectionTitle, cx } from '../../kit';
import type { SelectorOverrides, Settings } from '@/core/settings';
import { defaultSelectors, OVERRIDABLE_SITES, validateOverrides, type OverridableSite } from '@/core/overrides';

/**
 * Advanced: add CSS selectors per site when a shop changes its layout.
 * Yours are tried first; the built-in ones always stay as a fallback.
 */
export function SelectorEditor({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  const [draft, setDraft] = useState(() => JSON.stringify(s.selectorOverrides ?? {}, null, 2));
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [site, setSite] = useState<OverridableSite>('jiomart');
  const [filter, setFilter] = useState('');
  const defaults = useMemo(() => Object.entries(defaultSelectors(site)).filter(([k]) => k.toLowerCase().includes(filter.toLowerCase())), [site, filter]);

  const save = () => {
    let parsed: unknown;
    try { parsed = JSON.parse(draft || '{}'); } catch (e) { setErrors([`Not valid JSON: ${(e as Error).message}`]); return; }
    const problems = validateOverrides(parsed);
    setErrors(problems);
    if (problems.length) return;
    set({ selectorOverrides: parsed as SelectorOverrides });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const addPath = (path: string) => {
    let obj: any = {};
    try { obj = JSON.parse(draft || '{}'); } catch {}
    obj[site] = { ...(obj[site] ?? {}), [path]: obj[site]?.[path] ?? [''] };
    setDraft(JSON.stringify(obj, null, 2));
  };

  return (
    <Card>
      <SectionTitle>Site selectors (advanced)</SectionTitle>
      <div className="space-y-2 px-3 pb-3">
        <p className="text-[11px] text-muted">
          If a shop renames a button or price box, add the new CSS selector here. Yours are tried first; the built-in ones stay as backup. Changes apply immediately, no rebuild.
        </p>
        <textarea
          aria-label="Selector overrides (JSON)"
          spellCheck={false}
          className="h-40 w-full rounded-lg border border-line bg-raised p-2 font-mono text-[11px] text-ink focus:border-brand focus:outline-none"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={'{\n  "jiomart": { "product.currentPrice": [".NewPrice__value"] }\n}'}
        />
        {errors.length > 0 && <ul className="space-y-0.5 text-[11px] text-bad" role="alert">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        <div className="flex gap-2">
          <Button onClick={save}>{saved ? 'Saved' : 'Save selectors'}</Button>
          <Button variant="ghost" onClick={() => { setDraft('{}'); setErrors([]); set({ selectorOverrides: {} }); }}>Reset to built-in</Button>
        </div>

        <details className="pt-1">
          <summary className="cursor-pointer text-[12px] font-medium">Built-in selectors (click a name to add it above)</summary>
          <div className="mt-2 flex gap-2">
            {OVERRIDABLE_SITES.map((x) => (
              <button key={x} onClick={() => setSite(x)} className={cx('rounded-md px-2 py-1 text-[11px]', x === site ? 'bg-brand text-white' : 'border border-line')}>{x === 'jiomart' ? 'JioMart' : 'Amazon'}</button>
            ))}
            <input aria-label="Filter selector names" placeholder="filter, e.g. price" className="h-7 flex-1 rounded-md border border-line bg-raised px-2 text-[11px]" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {defaults.map(([path, list]) => (
              <li key={path} className="text-[11px]">
                <button className="font-mono text-brand hover:underline" onClick={() => addPath(path)}>{path}</button>
                <span className="block break-all font-mono text-muted">{list.join('  ·  ')}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </Card>
  );
}
