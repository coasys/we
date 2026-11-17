import { describe, expect, it, vi } from 'vitest';

import { ttlCache } from './ttlCache';

const clock = () => {
  let t = 1_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

describe('ttlCache', () => {
  it('shares one read between callers inside the window', async () => {
    const c = clock();
    const cache = ttlCache<string, number>(100, { now: c.now });
    const load = vi.fn(async () => 1);

    const a = cache.get('k', load);
    const b = cache.get('k', load);
    expect(a).toBe(b);
    c.advance(99);
    await cache.get('k', load);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reads again once the window has passed', async () => {
    const c = clock();
    const cache = ttlCache<string, number>(100, { now: c.now });
    let n = 0;
    const load = vi.fn(async () => ++n);

    expect(await cache.get('k', load)).toBe(1);
    c.advance(100);
    expect(await cache.get('k', load)).toBe(2);
  });

  it('keeps keys apart', async () => {
    const cache = ttlCache<string, string>(100);
    expect(await cache.get('a', async () => 'A')).toBe('A');
    expect(await cache.get('b', async () => 'B')).toBe('B');
  });

  it('never keeps a failed read, and still hands the failure to the caller', async () => {
    const cache = ttlCache<string, number>(100);
    await expect(cache.get('k', () => Promise.reject(new Error('down')))).rejects.toThrow('down');

    const load = vi.fn(async () => 2);
    expect(await cache.get('k', load)).toBe(2);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not let a slow failure evict a newer read of the same key', async () => {
    const c = clock();
    const cache = ttlCache<string, number>(100, { now: c.now });
    let fail!: (e: Error) => void;
    const first = cache.get('k', () => new Promise<number>((_, reject) => (fail = reject)));
    c.advance(100);
    const second = cache.get('k', async () => 2);

    fail(new Error('late'));
    await expect(first).rejects.toThrow('late');

    const load = vi.fn(async () => 3);
    expect(await cache.get('k', load)).toBe(2);
    expect(second).toBe(cache.get('k', load));
    expect(load).not.toHaveBeenCalled();
  });

  it('drops a read that `keep` refuses once it settles', async () => {
    const cache = ttlCache<string, number | null>(100, { keep: (v) => v !== null });
    expect(await cache.get('k', async () => null)).toBeNull();

    const load = vi.fn(async () => 5);
    expect(await cache.get('k', load)).toBe(5);
    expect(await cache.get('k', load)).toBe(5);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('forgets one key on drop, and every key on clear', async () => {
    const cache = ttlCache<string, number>(100);
    await cache.get('a', async () => 1);
    await cache.get('b', async () => 1);

    cache.drop('a');
    expect(await cache.get('a', async () => 2)).toBe(2);
    expect(await cache.get('b', async () => 2)).toBe(1);

    cache.clear();
    expect(await cache.get('b', async () => 3)).toBe(3);
  });

  it('keeps live entries when it prunes past maxEntries', async () => {
    const c = clock();
    const cache = ttlCache<string, number>(100, { maxEntries: 1, now: c.now });
    await cache.get('old', async () => 1);
    c.advance(100);
    await cache.get('live', async () => 1);
    // `old` was pruned when `live` went in; `live` is held.
    const reread = vi.fn(async () => 2);
    expect(await cache.get('live', reread)).toBe(1);
    expect(reread).not.toHaveBeenCalled();
  });
});
