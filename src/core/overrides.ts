// Selector overrides: Settings → Advanced lets you add CSS selectors per site
// without touching code. Your selectors are tried first, then the built-in ones,
// so a wrong override never removes a working default.

import { AMAZON } from '@/adapters/amazon/selectors';
import { JIOMART } from '@/adapters/jiomart/selectors';
import type { SelectorOverrides } from './settings';

const TARGETS = { amazon: AMAZON, jiomart: JIOMART } as const;
export type OverridableSite = keyof typeof TARGETS;
export const OVERRIDABLE_SITES = Object.keys(TARGETS) as OverridableSite[];

/** Paths of every list of CSS selectors in a site's selector file, e.g. "product.price". */
function selectorPaths(obj: any, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out.push(path);
    else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof RegExp)) out.push(...selectorPaths(v, path));
  }
  return out;
}

const get = (obj: any, path: string) => path.split('.').reduce((o, k) => o?.[k], obj);
const set = (obj: any, path: string, value: unknown) => {
  const keys = path.split('.');
  const last = keys.pop()!;
  const parent = keys.reduce((o, k) => o[k], obj);
  parent[last] = value;
};

// Built-in defaults, captured once before any override is applied.
const DEFAULTS: Record<OverridableSite, Record<string, string[]>> = Object.fromEntries(
  OVERRIDABLE_SITES.map((site) => [site, Object.fromEntries(selectorPaths(TARGETS[site]).map((p) => [p, [...(get(TARGETS[site], p) as string[])]]))]),
) as any;

export function defaultSelectors(site: OverridableSite): Record<string, string[]> {
  return DEFAULTS[site];
}

/** Rebuilds every selector list as [your selectors..., built-in selectors...]. Safe to call repeatedly. */
export function applyOverrides(overrides: SelectorOverrides | undefined) {
  for (const site of OVERRIDABLE_SITES) {
    for (const [path, defaults] of Object.entries(DEFAULTS[site])) {
      const extra = overrides?.[site]?.[path] ?? [];
      set(TARGETS[site], path, [...extra.filter((s) => !defaults.includes(s)), ...defaults]);
    }
  }
}

/** Checks site names, paths and CSS syntax. Returns human-readable problems (empty = OK). */
export function validateOverrides(value: unknown, testDoc: Document = document): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Must be an object like { "jiomart": { "product.currentPrice": [".my-price"] } }'];
  for (const [site, map] of Object.entries(value as Record<string, unknown>)) {
    if (!(OVERRIDABLE_SITES as string[]).includes(site)) { errors.push(`Unknown site "${site}" (use ${OVERRIDABLE_SITES.join(' or ')})`); continue; }
    if (!map || typeof map !== 'object' || Array.isArray(map)) { errors.push(`${site}: must be an object of path → [selectors]`); continue; }
    for (const [path, list] of Object.entries(map as Record<string, unknown>)) {
      if (!(path in DEFAULTS[site as OverridableSite])) { errors.push(`${site}: unknown path "${path}"`); continue; }
      if (!Array.isArray(list) || !list.every((s) => typeof s === 'string')) { errors.push(`${site}.${path}: must be a list of strings`); continue; }
      for (const sel of list as string[]) {
        try { testDoc.createDocumentFragment().querySelector(sel); } catch { errors.push(`${site}.${path}: invalid CSS selector "${sel}"`); }
      }
    }
  }
  return errors;
}

/** Loads overrides from storage and keeps them current (content scripts and the background). */
export async function watchOverrides() {
  const load = async () => {
    const { settings } = (await chrome.storage.local.get('settings')) as { settings?: { selectorOverrides?: SelectorOverrides } };
    applyOverrides(settings?.selectorOverrides);
  };
  await load();
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.settings) load(); });
}
