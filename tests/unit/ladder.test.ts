import { describe, it, expect } from 'vitest';
import { runLadder, MemoryLadderStats, BlockedError, type Strategy } from '@/core/ladder';

const ok = <T>(layer: Strategy<T>['layer'], value: T, log?: string[]): Strategy<T> => ({
  layer, name: `ok-${layer}`, run: async () => { log?.push(layer); return value; },
});
const fail = (layer: Strategy<never>['layer'], log?: string[]): Strategy<any> => ({
  layer, name: `fail-${layer}`, run: async () => { log?.push(layer); throw new Error(`boom ${layer}`); },
});

describe('runLadder', () => {
  it('returns the first layer that succeeds', async () => {
    const log: string[] = [];
    const r = await runLadder({ site: 'amazon', op: 'x', strategies: [fail('A', log), ok('B', 42, log), ok('C', 7, log)] });
    expect(r.ok && r.value).toBe(42);
    expect(r.ok && r.layer).toBe('B');
    expect(log).toEqual(['A', 'B']);
  });

  it('falls through when validation fails', async () => {
    const r = await runLadder({
      site: 'amazon', op: 'x',
      strategies: [ok('A', { price: null }), ok('B', { price: 99 })],
      validate: (v: any) => (v.price == null ? ['price'] : []),
    });
    expect(r.ok && r.value).toEqual({ price: 99 });
    expect(r.attempts[0].error).toMatch(/missing: price/);
  });

  it('times out a slow layer and moves on', async () => {
    const slow: Strategy<number> = { layer: 'A', name: 'slow', timeoutMs: 20, run: () => new Promise((res) => setTimeout(() => res(1), 500)) };
    const r = await runLadder({ site: 's', op: 'x', strategies: [slow, ok('B', 2)] });
    expect(r.ok && r.value).toBe(2);
    expect(r.attempts[0].error).toMatch(/timeout/);
  });

  it('reports all attempts when every layer fails', async () => {
    const r = await runLadder({ site: 's', op: 'x', strategies: [fail('A'), fail('B')] });
    expect(r.ok).toBe(false);
    expect(r.attempts).toHaveLength(2);
  });

  it('stops immediately on BlockedError (captcha/login)', async () => {
    const log: string[] = [];
    const blocked: Strategy<number> = { layer: 'A', name: 'b', run: async () => { log.push('A'); throw new BlockedError('captcha'); } };
    const r = await runLadder({ site: 's', op: 'x', strategies: [blocked, ok('B', 1, log)] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.blocked).toBe('captcha');
    expect(log).toEqual(['A']);
  });

  it('starts at the last winning layer, then tries earlier layers last', async () => {
    const stats = new MemoryLadderStats();
    const today = () => '2026-10-09';
    await runLadder({ site: 's', op: 'x', stats, today, strategies: [fail('A'), ok('B', 1)] });
    const log: string[] = [];
    await runLadder({ site: 's', op: 'x', stats, today, strategies: [fail('A', log), ok('B', 1, log)] });
    expect(log).toEqual(['B']);
  });

  it('keeps the normal order behind the sticky winner', async () => {
    const stats = new MemoryLadderStats();
    const today = () => '2026-10-09';
    await runLadder({ site: 's', op: 'x', stats, today, strategies: [fail('A'), fail('B'), ok('C', 1)] });
    const log: string[] = [];
    await runLadder({ site: 's', op: 'x', stats, today, strategies: [fail('A', log), fail('B', log), fail('C', log), ok('D', 1, log)] });
    expect(log).toEqual(['C', 'A', 'B', 'D']);
  });

  it('never remembers Claude (D) or the user (E) as the starting layer', async () => {
    const stats = new MemoryLadderStats();
    await runLadder({ site: 's', op: 'x', stats, today: () => 'd', strategies: [fail('A'), ok('D', 1)] });
    expect(await stats.get('s:x')).toBeUndefined();
  });

  it('retries from A once per day even with a sticky winner', async () => {
    const stats = new MemoryLadderStats();
    await runLadder({ site: 's', op: 'x', stats, today: () => '2026-10-09', strategies: [fail('A'), ok('B', 1)] });
    const log: string[] = [];
    await runLadder({ site: 's', op: 'x', stats, today: () => '2026-10-10', strategies: [ok('A', 5, log), ok('B', 1, log)] });
    expect(log).toEqual(['A']);
  });
});
