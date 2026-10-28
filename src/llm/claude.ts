// Layer D: when selectors and text patterns fail, Claude reads the (PII-masked)
// page text and returns the same shape the parsers would. Also used to pick
// which element to click when every selector and text match missed.

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { getSettings } from '@/core/settings';
import { normalizeStatus, STATUSES } from '@/core/status';
import { maskPII } from './mask';

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullable();

const TrackingOut = z.object({
  rawStatus: z.string().describe('Main status text exactly as shown, e.g. "Arriving Tuesday" or "Delivered 7 October"'),
  status: z.enum(STATUSES),
  courier: opt(z.string()),
  awb: opt(z.string()).describe('Courier tracking / AWB number'),
  eta: opt(z.string()),
  deliveredAt: opt(z.string()),
  events: z.array(z.object({ at: z.string(), text: z.string(), location: opt(z.string()) })),
});

const OrderOut = z.object({
  orderId: z.string(),
  orderDate: opt(z.string()).describe('YYYY-MM-DD'),
  items: z.array(z.object({ title: z.string(), qty: z.number().int(), unitPrice: opt(z.number()), seller: opt(z.string()), productId: opt(z.string()) })),
  total: opt(z.number()),
  subtotal: opt(z.number()),
  discount: opt(z.number()),
  paymentMode: opt(z.string()),
  shipCity: opt(z.string()),
  pincode: opt(z.string()),
  statusText: opt(z.string()),
  invoiceAvailable: opt(z.boolean()),
});

const OrderListOut = z.object({
  orders: z.array(z.object({ orderId: z.string(), orderDate: opt(z.string()), total: opt(z.number()), status: opt(z.string()) })),
});

const ProductOut = z.object({
  title: z.string(),
  unitPrice: opt(z.number()).describe('Current selling price in INR for one unit'),
  inStock: z.boolean(),
  maxQty: opt(z.number().int()).describe('Largest quantity selectable per order, if shown'),
});

const CartOut = z.object({
  subtotal: opt(z.number()),
  lines: z.array(z.object({ title: z.string(), qty: z.number().int(), unitPrice: opt(z.number()) })),
});

const TARGETS = {
  tracking: { schema: TrackingOut, task: 'Extract the shipment tracking state of this order.' },
  orderDetail: { schema: OrderOut, task: 'Extract this order\'s details.' },
  orderList: { schema: OrderListOut, task: 'List every order on this order-history page.' },
  product: { schema: ProductOut, task: 'Extract the product price and stock.' },
  cart: { schema: CartOut, task: 'Extract the shopping cart lines and subtotal.' },
} as const;

export type ExtractTarget = keyof typeof TARGETS;

const SYSTEM = `You extract data from Indian e-commerce pages (Amazon.in, Flipkart, JioMart) for the account owner's own order records.
Use only what the page text states. Use null for anything not shown; never guess numbers.
Prices are INR numbers without symbols or commas. Personal details are masked and must stay masked.`;

async function client() {
  const s = await getSettings();
  if (!s.claudeApiKey) throw new Error('layer D skipped: no Claude API key in Settings');
  // The key lives in chrome.storage.local and only goes to api.anthropic.com.
  return { c: new Anthropic({ apiKey: s.claudeApiKey, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 40_000 }), model: s.claudeModel };
}

const MAX_CHARS = 60_000;

export async function claudeExtract(target: ExtractTarget, pageText: string): Promise<unknown> {
  const { c, model } = await client();
  const { schema, task } = TARGETS[target];
  const text = maskPII(pageText).slice(0, MAX_CHARS);
  const res = await c.messages.parse({
    model,
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: 'low', format: zodOutputFormat(schema) },
    messages: [{ role: 'user', content: `${task}\n\n<page>\n${text}\n</page>` }],
  });
  if (res.stop_reason === 'refusal') throw new Error(`layer D refused: ${res.stop_details?.category ?? 'unknown'}`);
  const out = res.parsed_output as any;
  if (!out) throw new Error('layer D returned no parseable output');
  return reshape(target, out);
}

// Converts Claude's nullable shape into the parser shape the rest of the app uses.
function reshape(target: ExtractTarget, o: any): unknown {
  const strip = (v: any): any => (Array.isArray(v) ? v.map(strip) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, strip(x)]))
    : v);
  const v = strip(o);
  if (target === 'tracking') return { ...v, status: v.status === 'Unknown' ? normalizeStatus(v.rawStatus) : v.status, events: v.events ?? [] };
  if (target === 'orderDetail') {
    const { statusText, ...rest } = v;
    return {
      detail: { platform: 'amazon', ...rest, tracking: statusText ? { status: normalizeStatus(statusText), rawStatus: statusText, events: [] } : undefined },
      trackHrefs: [],
      invoiceHref: null,
    };
  }
  if (target === 'orderList') return { orders: v.orders, nextHref: null };
  if (target === 'product') return { asin: '', maxQty: 999, hasCoupon: false, unitPrice: null, ...v };
  if (target === 'cart') return { lines: (v.lines ?? []).map((l: any) => ({ asin: '', ...l, unitPrice: l.unitPrice ?? null })), subtotal: v.subtotal ?? null, itemCount: null };
  return v;
}

const PickOut = z.object({
  index: z.number().int().describe('Index of the element to click, or -1 if none fits'),
  reason: z.string(),
});

/** Layer D for clicks: choose which element achieves the goal. Payment controls are never offered. */
export async function claudePickElement(goal: string, inventory: Array<{ index: number; tag: string; text: string; blocked: boolean }>): Promise<number> {
  const { c, model } = await client();
  const allowed = inventory.filter((e) => !e.blocked);
  const list = allowed.map((e) => `${e.index}\t${e.tag}\t${e.text}`).join('\n');
  const res = await c.messages.parse({
    model,
    max_tokens: 1000,
    system: 'You choose which on-page control performs a shopping-cart step. Never choose a control that pays, places or confirms an order.',
    output_config: { effort: 'low', format: zodOutputFormat(PickOut) },
    messages: [{ role: 'user', content: `Goal: ${goal}\n\nControls (index, tag, label):\n${maskPII(list).slice(0, 20_000)}` }],
  });
  const idx = (res.parsed_output as any)?.index ?? -1;
  if (idx < 0 || !allowed.some((e) => e.index === idx)) throw new Error('layer D found no suitable control');
  return idx;
}
