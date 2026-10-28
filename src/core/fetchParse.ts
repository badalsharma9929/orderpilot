// Fetch a page (or the site's JSON API) with the user's session and run a
// named parser over it. The same function serves layer A (offscreen document)
// and layer B (content script on a site tab), so both layers always agree.

import { PARSERS, JSON_PARSERS, FLAGS, apiHeaders, isJsonParser, platformOfParser, type ParserName, type HtmlParserName } from '@/adapters/registry';
import { pageText } from '@/adapters/common';

export type FetchParseResult =
  | { ok: true; data: unknown; finalUrl: string; ms: number }
  | { ok: false; reason: 'pushback'; status: number }
  | { ok: false; reason: 'captcha' | 'signed-out'; finalUrl: string }
  | { ok: false; reason: 'http' | 'network' | 'parse'; status?: number; message: string };

/** JioMart's API wants the delivery pincode; a content script can read it from the site's own storage. */
function withAreaCode(url: string): string {
  if (!/\/api\/service\/application\/cart\//.test(url) || /[?&]area_code=/.test(url)) return url;
  try {
    const pin = JSON.parse(globalThis.localStorage?.getItem('pin') ?? 'null')?.pincode;
    return pin ? `${url}${url.includes('?') ? '&' : '?'}area_code=${pin}` : url;
  } catch {
    return url;
  }
}

export async function fetchParse(url: string, parser: ParserName, args?: unknown, timeoutMs = 8000): Promise<FetchParseResult> {
  const started = Date.now();
  const json = isJsonParser(parser);
  const target = json ? withAreaCode(url) : url;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(target, {
      credentials: 'include',
      redirect: 'follow',
      signal: ctl.signal,
      headers: json ? apiHeaders(platformOfParser(parser)) : { Accept: 'text/html,application/xhtml+xml' },
    });
  } catch (e) {
    clearTimeout(t);
    return { ok: false, reason: 'network', message: e instanceof Error ? e.message : String(e) };
  }
  clearTimeout(t);
  if (res.status === 429 || res.status === 503) return { ok: false, reason: 'pushback', status: res.status };
  if (json) {
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'signed-out', finalUrl: res.url || url };
    if (!res.ok) return { ok: false, reason: 'http', status: res.status, message: `HTTP ${res.status}` };
    if (!(res.headers.get('content-type') ?? '').includes('json')) return { ok: false, reason: 'parse', message: 'expected JSON, got a page' };
    try {
      const body = await res.json();
      const data = (JSON_PARSERS[parser] as (j: unknown, u: string, a?: unknown) => unknown)(body, res.url || url, args);
      return { ok: true, data, finalUrl: res.url || url, ms: Date.now() - started };
    } catch (e) {
      return { ok: false, reason: 'parse', message: e instanceof Error ? e.message : String(e) };
    }
  }
  if (!res.ok) return { ok: false, reason: 'http', status: res.status, message: `HTTP ${res.status}` };
  const html = await res.text();
  return parseHtml(html, res.url || url, parser, args, started);
}

export function parseHtml(html: string, url: string, parser: ParserName, args?: unknown, started = Date.now()): FetchParseResult {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return parseDocument(doc, url, parser, args, started);
}

export function parseDocument(doc: Document, url: string, parser: ParserName, args?: unknown, started = Date.now()): FetchParseResult {
  if (isJsonParser(parser)) return { ok: false, reason: 'parse', message: 'JSON parser cannot read a rendered page' };
  const flags = FLAGS[platformOfParser(parser)](doc, url);
  if (flags.captcha) return { ok: false, reason: 'captcha', finalUrl: url };
  // Account parser decides sign-in state itself; everything else needs a session.
  if (flags.signedOut && !parser.endsWith('.account') && !parser.endsWith('.product')) return { ok: false, reason: 'signed-out', finalUrl: url };
  try {
    const data = (PARSERS[parser as HtmlParserName] as (d: Document, u: string, a?: unknown) => unknown)(doc, url, args);
    return { ok: true, data, finalUrl: url, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, reason: 'parse', message: e instanceof Error ? e.message : String(e) };
  }
}

/** Text for Claude (layer D) or for saving a page for selector tuning. */
export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { credentials: 'include' });
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  return pageText(doc);
}
