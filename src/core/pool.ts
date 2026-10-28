// Per-site concurrency pool. Runs flat out until the site pushes back
// (429/503/captcha page/timeout), then halves concurrency and backs off
// exponentially; climbs back one slot per 10 clean results.

export class PushbackError extends Error {
  constructor(public status: number | 'captcha' | 'timeout', message?: string) {
    super(message ?? `site pushback: ${status}`);
    this.name = 'PushbackError';
  }
}

export interface PoolOptions {
  concurrency?: number;
  max?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class SitePool {
  concurrency: number;
  private readonly max: number;
  private readonly maxRetries: number;
  private readonly base: number;
  private readonly cap: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private active = 0;
  private queue: Array<() => void> = [];
  private clean = 0;
  private level = 0;
  private cooldown: Promise<void> | null = null;

  constructor(o: PoolOptions = {}) {
    this.concurrency = o.concurrency ?? 6;
    this.max = o.max ?? 12;
    this.maxRetries = o.maxRetries ?? 3;
    this.base = o.baseBackoffMs ?? 2000;
    this.cap = o.maxBackoffMs ?? 60000;
    this.sleep = o.sleep ?? defaultSleep;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await this.acquireAfterCooldown();
      let result: { v: T } | { err: unknown };
      try {
        result = { v: await task() };
      } catch (err) {
        result = { err };
      }

      if ('v' in result) {
        this.release();
        this.onClean();
        return result.v;
      }
      const err = result.err;
      if (!(err instanceof PushbackError)) {
        this.release();
        throw err;
      }
      // Start the cooldown *before* freeing the slot, so queued tasks see it.
      const wait = this.onPushback();
      this.cooldown ??= this.sleep(wait).then(() => { this.cooldown = null; });
      this.release();
      if (attempt >= this.maxRetries) throw err;
    }
  }

  private async acquireAfterCooldown() {
    for (;;) {
      if (this.cooldown) await this.cooldown;
      await this.acquire();
      if (!this.cooldown) return;
      // A pushback happened while we were queued: give the slot back and wait.
      this.release();
    }
  }

  private onClean() {
    this.clean++;
    if (this.clean >= 10) {
      this.clean = 0;
      this.level = 0;
      if (this.concurrency < this.max) this.concurrency++;
      this.drain();
    }
  }

  private onPushback(): number {
    this.clean = 0;
    this.concurrency = Math.max(1, Math.floor(this.concurrency / 2));
    const wait = Math.min(this.cap, this.base * 2 ** this.level);
    this.level++;
    return wait;
  }

  private acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(() => { this.active++; resolve(); }));
  }

  private release() {
    if (this.active > 0) this.active--;
    this.drain();
  }

  private drain() {
    while (this.active < this.concurrency && this.queue.length) this.queue.shift()!();
  }
}
