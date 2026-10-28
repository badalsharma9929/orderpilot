import type { Platform } from './schemas';
import type { QtyRule } from './qty';

/** Extra CSS selectors per site, keyed by the selector path, e.g. { jiomart: { "product.currentPrice": [".my-price"] } }. */
export type SelectorOverrides = Partial<Record<Platform, Record<string, string[]>>>;

export interface Settings {
  // Daily check
  sweepTime: string;            // "HH:MM" local
  eveningSweep: boolean;
  eveningTime: string;
  /** Sites the daily check covers. */
  sites: Platform[];
  /** 0 = whole order history (first check reads every page once, later checks stop at known orders). */
  discoveryMonths: 0 | 3 | 6 | 12;
  /** Keep re-reading finished orders that still miss fields for this many days. */
  retryIncompleteDays: number;
  concurrency: Record<Platform, number>;
  notify: boolean;

  // Cart Builder rules
  qtyRule: QtyRule;
  /** Your own per-order cap; 0 = only the site's limit. */
  maxQtyCap: number;
  /** Extra units tried if the subtotal lands under the target (rule "reach" only). */
  raiseAttempts: number;

  /** Business GSTIN for a GST invoice on JioMart orders ('' = off). */
  gstin: string;

  // Invoices
  autoInvoices: boolean;
  /** Folder inside Downloads. */
  invoiceFolder: string;
  /** 0 = every order, however old. */
  invoiceLookbackDays: number;

  // Excel report
  /** Save an .xlsx with every order after each check. */
  autoExcel: boolean;
  /** Folder inside Downloads. */
  reportFolder: string;

  // AI fallback
  claudeApiKey: string;
  claudeModel: string;

  /** Advanced: extra selectors tried before the built-in ones. */
  selectorOverrides: SelectorOverrides;

  theme: 'system' | 'light' | 'dark';
}

export const DEFAULT_SETTINGS: Settings = {
  sweepTime: '09:00',
  eveningSweep: false,
  eveningTime: '18:00',
  sites: ['amazon', 'jiomart'],
  discoveryMonths: 0,
  retryIncompleteDays: 60,
  concurrency: { amazon: 6, flipkart: 6, jiomart: 6 },
  notify: true,
  qtyRule: 'reach',
  maxQtyCap: 0,
  raiseAttempts: 2,
  gstin: '',
  autoInvoices: true,
  invoiceFolder: 'OrderPilot/Invoices',
  invoiceLookbackDays: 0,
  autoExcel: true,
  reportFolder: 'OrderPilot/Reports',
  claudeApiKey: '',
  claudeModel: 'claude-haiku-5-5',
  selectorOverrides: {},
  theme: 'system',
};

const SETTINGS_VERSION = 2;

export async function getSettings(): Promise<Settings> {
  const { settings } = (await chrome.storage.local.get('settings')) as { settings?: Partial<Settings> & { v?: number } };
  // One-time upgrade: v2 reads the whole order history and every invoice by default.
  if (settings && (settings.v ?? 1) < SETTINGS_VERSION) {
    Object.assign(settings, { discoveryMonths: 0, invoiceLookbackDays: 0, v: SETTINGS_VERSION });
    await chrome.storage.local.set({ settings });
  }
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}), concurrency: { ...DEFAULT_SETTINGS.concurrency, ...(settings?.concurrency ?? {}) } };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch, v: SETTINGS_VERSION };
  await chrome.storage.local.set({ settings: next });
  return next;
}

/** GSTIN format: 2-digit state code, 10-char PAN, entity digit, 'Z', check character. */
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Folder under Downloads: forward slashes, no leading/trailing slash, no "..". */
export function cleanFolder(f: string): string {
  const parts = f.replace(/\\/g, '/').split('/').map((p) => p.trim().replace(/[:*?"<>|]/g, '')).filter((p) => p && p !== '.' && p !== '..');
  return parts.join('/') || DEFAULT_SETTINGS.invoiceFolder;
}
