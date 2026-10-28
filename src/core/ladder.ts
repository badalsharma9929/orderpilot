// Layered execution: every fetch and every click runs as an ordered list of
// strategies (A fastest … E hand-off). A layer "wins" only if it returns
// without throwing, inside its timeout, and passes validation.

export type Layer = 'A' | 'B' | 'C' | 'D' | 'E';

export interface Strategy<T> {
  layer: Layer;
  name: string;
  timeoutMs?: number;
  run: (signal: AbortSignal) => Promise<T>;
}

export interface Attempt {
  layer: Layer;
  name: string;
  ms: number;
  error?: string;
}

export type LadderResult<T> =
  | { ok: true; value: T; layer: Layer; name: string; attempts: Attempt[] }
  | { ok: false; attempts: Attempt[]; blocked?: BlockReason };

export type BlockReason = 'captcha' | 'otp' | 'login' | 'payment-guard' | 'rate-limit';

/** Thrown by a strategy when no other layer can help (captcha, logged out, payment guard). */
export class BlockedError extends Error {
  constructor(public reason: BlockReason, message?: string) {
    super(message ?? reason);
    this.name = 'BlockedError';
  }
}

export interface LadderStat {
  winner: Layer;
  /** Day (YYYY-MM-DD) on which the full A→E order was last tried. */
  fullTryDay: string;
}

export interface LadderStatsStore {
  get(key: string): Promise<LadderStat | undefined>;
  set(key: string, stat: LadderStat): Promise<void>;
}

export class MemoryLadderStats implements LadderStatsStore {
  private map = new Map<string, LadderStat>();
  async get(key: string) { return this.map.get(key); }
  async set(key: string, stat: LadderStat) { this.map.set(key, stat); }
}

export interface LadderOptions<T> {
  site: string;
  op: string;
  strategies: Strategy<T>[];
  /** Returns the list of problems (missing fields etc.); empty means valid. */
  validate?: (value: T) => string[];
  stats?: LadderStatsStore;
  today?: () => string;
  defaultTimeoutMs?: number;
  onAttempt?: (a: Attempt) => void;
}

const isoDay = () => new Date().toISOString().slice(0, 10);

export async function runLadder<T>(opts: LadderOptions<T>): Promise<LadderResult<T>> {
  const { site, op, validate, stats, onAttempt } = opts;
  const today = (opts.today ?? isoDay)();
  const key = `${site}:${op}`;
  const order = await orderStrategies(opts.strategies, stats, key, today);
  const attempts: Attempt[] = [];

  for (const s of order) {
    const started = Date.now();
    const ctl = new AbortController();
    try {
      const value = await withTimeout(s.run(ctl.signal), s.timeoutMs ?? opts.defaultTimeoutMs ?? 8000, ctl);
      const problems = validate ? validate(value) : [];
      if (problems.length) throw new Error(`invalid result, missing: ${problems.join(', ')}`);
      const a = { layer: s.layer, name: s.name, ms: Date.now() - started };
      attempts.push(a);
      onAttempt?.(a);
      // Claude (D) and asking the user (E) are last resorts; never start there next time.
      if (stats && s.layer !== 'D' && s.layer !== 'E') await stats.set(key, { winner: s.layer, fullTryDay: today });
      return { ok: true, value, layer: s.layer, name: s.name, attempts };
    } catch (err) {
      const a = { layer: s.layer, name: s.name, ms: Date.now() - started, error: errorText(err) };
      attempts.push(a);
      onAttempt?.(a);
      if (err instanceof BlockedError) return { ok: false, attempts, blocked: err.reason };
    }
  }
  return { ok: false, attempts };
}

async function orderStrategies<T>(list: Strategy<T>[], stats: LadderStatsStore | undefined, key: string, today: string) {
  if (!stats) return list;
  const stat = await stats.get(key);
  // Once a day run the full order so a faster layer that started working again is rediscovered.
  if (!stat || stat.fullTryDay !== today) return list;
  const idx = list.findIndex((s) => s.layer === stat.winner);
  if (idx <= 0) return list;
  // Winner first, everything else in its normal fastest-first order.
  return [list[idx], ...list.slice(0, idx), ...list.slice(idx + 1)];
}

function withTimeout<T>(p: Promise<T>, ms: number, ctl: AbortController): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      ctl.abort();
      reject(new Error(`timeout after ${ms}ms`));
    }, ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
