// The fetch ladder: A offscreen fetch → B fetch inside an open site tab →
// C render in a hidden worker tab → D Claude (when a key is set) → E report.

import { runLadder, BlockedError, type Strategy, type LadderResult } from '@/core/ladder';
import { PushbackError, SitePool } from '@/core/pool';
import { DexieLadderStats } from '@/db/dexie';
import type { FetchParseResult } from '@/core/fetchParse';
import type { ParserName, ParserOutput } from '@/adapters/registry';
import { isJsonParser, platformOfParser } from '@/adapters/registry';
import type { Platform } from '@/core/schemas';
import { toOffscreen } from './offscreen';
import { ensureSitePage, findSiteTab, navigate, sendToTab, sitePageUrl, withWorkerTab } from './tabs';
import { getSettings } from '@/core/settings';
import { claudeExtract, type ExtractTarget } from '@/llm/claude';
import { notify } from './progress';

const stats = new DexieLadderStats();
// Cache the promise, not the pool: concurrent first callers must share one pool.
const pools = new Map<Platform, Promise<SitePool>>();

export function poolFor(platform: Platform): Promise<SitePool> {
  let p = pools.get(platform);
  if (!p) {
    p = getSettings().then((s) => new SitePool({ concurrency: s.concurrency[platform], max: 12 }));
    pools.set(platform, p);
  }
  return p;
}

let captchaNotifiedAt = 0;

// Circuit breaker: once a site shows a CAPTCHA or keeps rate-limiting, stop
// asking it for a while instead of hammering it (that is what gets you blocked).
const BREAK_MS = 30 * 60_000;
const brokenUntil = new Map<Platform, number>();
export const siteBlocked = (p: Platform) => (brokenUntil.get(p) ?? 0) > Date.now();
export const resetBreaker = (p?: Platform) => (p ? brokenUntil.delete(p) : brokenUntil.clear());

/**
 * Turns a serialised fetchParse result into a value or the right error type.
 * A "signed out" page from a background fetch (A/B) can just mean the request
 * lost its cookies, so it falls through; only a real tab render (C) proves it.
 */
function unwrap<T>(r: FetchParseResult | undefined, layer: string): T {
  if (!r) throw new Error(`${layer}: no response`);
  if (r.ok) return r.data as T;
  if (r.reason === 'pushback') throw new PushbackError(r.status);
  if (r.reason === 'signed-out') {
    if (layer === 'C') throw new BlockedError('login', 'signed out');
    throw new Error(`${layer}: page looked signed out`);
  }
  if (r.reason === 'captcha') throw new PushbackError('captcha', 'captcha page');
  throw new Error(`${r.reason}: ${'message' in r ? r.message : ''}`);
}

export interface ReadOptions<N extends ParserName> {
  args?: unknown;
  validate?: (v: ParserOutput<N>) => string[];
  /** Enables layer D for this read: what Claude should extract if A–C fail. */
  claude?: ExtractTarget;
  /** Skip the shared pool (used when the caller already holds a slot). */
  noPool?: boolean;
  op?: string;
}

export async function read<N extends ParserName>(url: string, parser: N, opts: ReadOptions<N> = {}): Promise<LadderResult<ParserOutput<N>>> {
  const platform = platformOfParser(parser);
  if (siteBlocked(platform)) {
    return { ok: false, blocked: 'captcha', attempts: [{ layer: 'A', name: 'paused', ms: 0, error: `${platform} paused for 30 min after a block — not sending more requests` }] };
  }
  const strategies: Strategy<ParserOutput<N>>[] = [
    {
      layer: 'A', name: 'offscreen-fetch', timeoutMs: 10000,
      run: async () => unwrap(await toOffscreen<FetchParseResult>({ kind: 'offscreen', op: 'fetchParse', url, parser, args: opts.args, overrides: (await getSettings()).selectorOverrides }), 'A'),
    },
    {
      layer: 'B', name: 'site-tab-fetch', timeoutMs: 25000,
      run: async () => {
        const msg = { kind: 'cs' as const, op: 'fetchParse' as const, url, parser, args: opts.args };
        // Same-origin fetch carries the login cookie. Use an open tab of the site,
        // or a light background page of it when none is open (daily checks).
        const tab = await findSiteTab(platform);
        if (tab?.id) {
          try { return unwrap(await sendToTab<FetchParseResult>(tab.id, msg, 9000), 'B'); } catch (e) { if (e instanceof BlockedError) throw e; }
        }
        const origin = new URL(url).origin;
        return withWorkerTab(async (tabId) => {
          await ensureSitePage(tabId, origin);
          return unwrap(await sendToTab<FetchParseResult>(tabId, msg, 9000), 'B');
        }, sitePageUrl(origin));
      },
    },
    {
      layer: 'C', name: 'worker-tab-render', timeoutMs: 30000,
      run: () => withWorkerTab(async (tabId) => {
        await navigate(tabId, url, 25000);
        const r = await sendToTab<FetchParseResult>(tabId, { kind: 'cs', op: 'parseLive', parser, args: opts.args }, 8000);
        // A real page showing a captcha needs the user; no layer can fix that.
        if (r && !r.ok && r.reason === 'captcha') throw new BlockedError('captcha', `captcha on ${url}`);
        return unwrap(r, 'C');
      }),
    },
  ];
  // An API (JSON) read has no page to render: only layers A and B apply; the caller
  // falls back to reading the matching web page (which has C and D).
  if (isJsonParser(parser)) strategies.splice(2);
  else if (opts.claude) {
    const target = opts.claude;
    strategies.push({
      layer: 'D', name: 'claude-extract', timeoutMs: 45000,
      run: () => withWorkerTab(async (tabId) => {
        await navigate(tabId, url, 25000);
        const page = await sendToTab<{ ok: boolean; text: string }>(tabId, { kind: 'cs', op: 'pageText' }, 8000);
        return (await claudeExtract(target, page.text)) as ParserOutput<N>;
      }),
    });
  }

  const exec = () => runLadder({ site: platform, op: opts.op ?? parser, strategies, validate: opts.validate, stats });
  let result: LadderResult<ParserOutput<N>>;
  try {
    if (opts.noPool) result = await exec();
    else {
      const pool = await poolFor(platform);
      // Every layer hit a rate limit: surface it so the pool slows the whole site down and retries.
      result = await pool.run(async () => {
        const r = await exec();
        if (!r.ok && !r.blocked && r.attempts.length && r.attempts.every((a) => /pushback|429|503/.test(a.error ?? ''))) throw new PushbackError(429);
        return r;
      });
    }
  } catch (e) {
    // read() never rejects: callers run many reads with Promise.all and must get every result.
    result = { ok: false, attempts: [{ layer: 'A', name: 'pool', ms: 0, error: e instanceof Error ? e.message : String(e) }], blocked: e instanceof PushbackError ? 'rate-limit' : undefined };
  }
  if (!result.ok && (result.blocked === 'captcha' || result.blocked === 'rate-limit')) brokenUntil.set(platform, Date.now() + BREAK_MS);
  if (!result.ok && result.blocked === 'captcha' && Date.now() - captchaNotifiedAt > 10 * 60_000) {
    captchaNotifiedAt = Date.now();
    notify(`${platform} is asking for a CAPTCHA`, 'Open the site, solve the check, then press "Check status now". OrderPilot never solves CAPTCHAs.');
  }
  return result;
}
