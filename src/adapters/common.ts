// Helpers shared by site parsers. Parsers take a Document so the same code
// runs on fetched HTML (DOMParser), inside a content script, and in jsdom tests.

import { parseInr } from '@/core/qty';

export const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

export function textOf(doc: ParentNode, selectors: string[]): string {
  for (const sel of selectors) {
    let el: Element | null = null;
    try { el = doc.querySelector(sel); } catch { continue; }
    const t = el ? spaced(el) : '';
    if (t) return t;
  }
  return '';
}

/** Visible text with a space between text nodes, so "₹199" + "50% OFF" never becomes "₹19950% OFF". */
export function spaced(el: Element): string {
  const out: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) { const t = n.textContent?.trim(); if (t) out.push(t); }
    else if (n.nodeType === 1 && !/^(SCRIPT|STYLE|NOSCRIPT)$/.test((n as Element).tagName)) n.childNodes.forEach(walk);
  };
  walk(el);
  return clean(out.join(' '));
}

export function attrOf(doc: ParentNode, selectors: string[], attr: string): string {
  for (const sel of selectors) {
    let el: Element | null = null;
    try { el = doc.querySelector(sel); } catch { continue; }
    const v = el?.getAttribute(attr)?.trim();
    if (v) return v;
  }
  return '';
}

export const priceOf = (doc: ParentNode, selectors: string[]) => parseInr(textOf(doc, selectors));

/** Whole visible text, one line per block-ish element; used for regex fallbacks and Claude. */
export function pageText(doc: Document): string {
  const body = doc.body;
  if (!body) return '';
  const clone = body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('script, style, noscript, svg, iframe, template').forEach((n) => n.remove());
  clone.querySelectorAll('br, p, div, li, tr, h1, h2, h3, h4, h5, h6, section, span.a-list-item').forEach((n) => n.append('\n'));
  return (clone.textContent ?? '').split('\n').map(clean).filter(Boolean).join('\n');
}

/** Value that follows a label in text, e.g. "Tracking ID: 123" or "Order placed\n12 October 2026". */
export function labelled(text: string, label: RegExp, value = /([^\n]+)/): string {
  const re = new RegExp(`(?:${label.source})\\s*[:#]?\\s*(?:\\n\\s*)?${value.source}`, 'i');
  return clean(text.match(re)?.[1]);
}

export const BLOCKER_MARKERS = [
  'enter the characters you see',
  'type the characters you see',
  "sorry, we just need to make sure you're not a robot",
  'robot check',
  'verify you are human',
  'captcha',
];

export function detectCaptcha(doc: Document): boolean {
  const t = (doc.body?.textContent ?? '').toLowerCase().slice(0, 20000);
  return BLOCKER_MARKERS.some((m) => t.includes(m)) || !!doc.querySelector('form[action*="validateCaptcha"], #captchacharacters');
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "12 October 2026" / "Oct 12, 2026" / "12-10-2026" → "2026-10-12"; returns input when unparseable. */
export function toIsoDate(s: string): string {
  const t = clean(s);
  let m = t.match(/(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return iso(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
  m = t.match(/([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return iso(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
  m = t.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return iso(+m[3], +m[2], +m[1]);
  m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  return t;
}
const iso = (y: number, mo: number, d: number) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
