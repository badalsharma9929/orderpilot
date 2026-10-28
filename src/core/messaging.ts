import type { ParserName } from '@/adapters/registry';
import type { FetchParseResult } from './fetchParse';
import type { Platform } from './schemas';

/** Messages handled by content scripts. */
export type CsRequest =
  | { kind: 'cs'; op: 'ping' }
  | { kind: 'cs'; op: 'parseLive'; parser: ParserName; args?: unknown }
  | { kind: 'cs'; op: 'fetchParse'; url: string; parser: ParserName; args?: unknown }
  | { kind: 'cs'; op: 'fetchBytes'; url: string }
  | { kind: 'cs'; op: 'action'; action: string; args?: any }
  | { kind: 'cs'; op: 'pageText' }
  | { kind: 'cs'; op: 'pageHtml' }
  | { kind: 'cs'; op: 'highlight'; text: string };

/** Messages handled by the offscreen document. */
export type OffscreenRequest =
  | { kind: 'offscreen'; op: 'fetchParse'; url: string; parser: ParserName; args?: unknown; overrides?: import('./settings').SelectorOverrides }
  | { kind: 'offscreen'; op: 'buildZip'; invoiceKeys: string[] }
  | { kind: 'offscreen'; op: 'buildReport' }
  | { kind: 'offscreen'; op: 'revoke'; url: string };

/** Messages handled by the background worker. */
export type BgRequest =
  | { kind: 'bg'; op: 'cart.run'; input: CartInput }
  | { kind: 'bg'; op: 'cart.cancel' }
  | { kind: 'bg'; op: 'sweep.run'; platforms?: Platform[] }
  | { kind: 'bg'; op: 'invoices.run' }
  | { kind: 'bg'; op: 'report.export' }
  | { kind: 'bg'; op: 'invoices.zipRange'; from: string; to: string; accountId?: string }
  | { kind: 'bg'; op: 'orders.captured'; platform: Platform; orderIds: string[]; account?: string; origin: string }
  | { kind: 'bg'; op: 'page.save' }
  | { kind: 'bg'; op: 'alarms.reschedule' };

export interface CartInput { url: string; coupon?: string; target: number; qty?: number }

export interface ProgressEvent {
  kind: 'progress';
  job: 'cart' | 'sweep' | 'invoices';
  at: string;
  step: string;
  ok?: boolean;
  layer?: string;
  note?: string;
  done?: boolean;
}

export type CsActionResult = { ok: true; data?: any; layer?: string } | { ok: false; error: string; blocked?: string };

export type { FetchParseResult };
