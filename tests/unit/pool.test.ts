import { describe, it, expect } from 'vitest';
import { SitePool, PushbackError } from '@/core/pool';

const noSleep = async () => {};

describe('SitePool', () => {
  it('never runs more than `concurrency` tasks at once', async () => {
    const pool = new SitePool({ concurrency: 3, max: 3, sleep: noSleep });
    let live = 0, peak = 0;
    const task = async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); live--; return 1; };
    await Promise.all(Array.from({ length: 12 }, () => pool.run(task)));
    expect(peak).toBe(3);
  });

  it('halves concurrency on pushback and retries the task', async () => {
    const waits: number[] = [];
    const pool = new SitePool({ concurrency: 6, max: 12, sleep: async (ms) => { waits.push(ms); } });
    let calls = 0;
    const v = await pool.run(async () => { if (calls++ === 0) throw new PushbackError(429); return 'ok'; });
    expect(v).toBe('ok');
    expect(pool.concurrency).toBe(3);
    expect(waits[0]).toBe(2000);
  });

  it('backs off exponentially and gives up after maxRetries', async () => {
    const waits: number[] = [];
    const pool = new SitePool({ concurrency: 4, max: 4, maxRetries: 3, sleep: async (ms) => { waits.push(ms); } });
    await expect(pool.run(async () => { throw new PushbackError(503); })).rejects.toBeInstanceOf(PushbackError);
    // The last pushback still starts a cooldown for queued tasks, even though this task gives up.
    expect(waits).toEqual([2000, 4000, 8000, 16000]);
    expect(pool.concurrency).toBe(1);
  });

  it('makes queued tasks wait out the cooldown too', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const pool = new SitePool({ concurrency: 1, max: 1, sleep: () => gate });
    const order: string[] = [];
    let first = true;
    const a = pool.run(async () => { if (first) { first = false; throw new PushbackError(429); } order.push('a-retry'); });
    const b = pool.run(async () => { order.push('b'); });
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual([]); // b is queued behind the cooldown, not hammering the site
    release();
    await Promise.all([a, b]);
    expect(order.sort()).toEqual(['a-retry', 'b']);
  });

  it('ramps concurrency back up after 10 clean results', async () => {
    const pool = new SitePool({ concurrency: 2, max: 4, sleep: noSleep });
    for (let i = 0; i < 10; i++) await pool.run(async () => 1);
    expect(pool.concurrency).toBe(3);
  });

  it('passes ordinary errors through without backing off', async () => {
    const pool = new SitePool({ concurrency: 4, max: 4, sleep: noSleep });
    await expect(pool.run(async () => { throw new Error('parse'); })).rejects.toThrow('parse');
    expect(pool.concurrency).toBe(4);
  });
});
