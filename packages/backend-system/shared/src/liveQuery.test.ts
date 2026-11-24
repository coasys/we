import { describe, expect, it, vi } from 'vitest';

import { combineLiveQueries, createLiveQuery, mapLiveQuery } from './liveQuery';

const tick = () => new Promise((r) => setTimeout(r, 0));

function source<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    set(next: T) {
      value = next;
      for (const l of [...listeners]) l();
    },
    read: () => value,
    watch: (l: () => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
}

describe('createLiveQuery', () => {
  it('is loading, then opens on the first result with initial set', async () => {
    const src = source({ n: 1 });
    const live = createLiveQuery(src);
    expect(live.getSnapshot().status).toBe('loading');
    expect(await live.first).toEqual({ n: 1 });
    expect(live.getSnapshot()).toMatchObject({ status: 'ready', initial: true });
    live.dispose();
  });

  it('calls a subscriber at once once ready, then on a change with initial false', async () => {
    const src = source({ n: 1 });
    const live = createLiveQuery(src);
    await live.first;
    const fn = vi.fn();
    live.subscribe(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    src.set({ n: 2 });
    await tick();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.lastCall![0]).toMatchObject({ data: { n: 2 }, initial: false });
    live.dispose();
  });

  it('keeps the same snapshot when the result is equal with keys in another order', async () => {
    const src = source<Record<string, number>>({ a: 1, b: 2 });
    const live = createLiveQuery(src);
    await live.first;
    const before = live.getSnapshot();
    src.set({ b: 2, a: 1 });
    await tick();
    expect(live.getSnapshot()).toBe(before);
    live.dispose();
  });

  it('follows a changed Map result instead of reading it as an empty object', async () => {
    const src = source(new Map([['value', 1]]));
    const live = createLiveQuery(src);
    await live.first;
    src.set(new Map([['value', 2]]));
    await tick();
    expect(live.getSnapshot().data).toEqual(new Map([['value', 2]]));
    live.dispose();
  });

  it('returns a failed handle when the source cannot be watched', async () => {
    const live = createLiveQuery({
      read: () => 1,
      watch: () => {
        throw new Error('cannot watch');
      },
    });
    await expect(live.first).rejects.toThrow('cannot watch');
    expect(live.getSnapshot()).toMatchObject({ status: 'error' });
  });

  it('stops calling after dispose, and rejects first when disposed before it answered', async () => {
    const src = source(1);
    const live = createLiveQuery(src);
    const fn = vi.fn();
    live.subscribe(fn);
    live.dispose();
    await expect(live.first).rejects.toThrow(/disposed/);
    src.set(2);
    await tick();
    expect(fn).not.toHaveBeenCalled();
  });

  it('fails when the first read fails', async () => {
    const live = createLiveQuery({
      read: () => Promise.reject(new Error('no')),
      watch: () => () => undefined,
    });
    await expect(live.first).rejects.toThrow('no');
    expect(live.getSnapshot()).toMatchObject({ status: 'error' });
  });

  it('settles first and calls the other listeners when one throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const live = createLiveQuery(source(1));
    const after = vi.fn();
    live.subscribe(() => {
      throw new Error('listener');
    });
    live.subscribe(after);
    expect(await live.first).toBe(1);
    expect(after).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    live.dispose();
  });

  it('calls no listener after one disposes the handle or removes another', async () => {
    const live = createLiveQuery(source(1));
    const later = vi.fn();
    let removeLater!: () => void;
    live.subscribe(() => removeLater());
    removeLater = live.subscribe(later);
    const disposing = createLiveQuery(source(1));
    const afterDispose = vi.fn();
    disposing.subscribe(() => disposing.dispose());
    disposing.subscribe(afterDispose);
    await Promise.all([live.first, disposing.first]);
    expect(later).not.toHaveBeenCalled();
    expect(afterDispose).not.toHaveBeenCalled();
    live.dispose();
  });

  it('reads again after a change heard during a read, so the newest state lands last', async () => {
    let value = 'A';
    const pending: (() => void)[] = [];
    let changed!: () => void;
    const live = createLiveQuery({
      // Each read sees the value when it starts and answers when the test releases it.
      read: () => {
        const seen = value;
        return new Promise<string>((resolve) => pending.push(() => resolve(seen)));
      },
      watch: (cb) => {
        changed = cb;
        return () => undefined;
      },
    });
    await tick();
    value = 'B';
    changed();
    expect(pending).toHaveLength(1);
    pending.shift()!();
    expect(await live.first).toBe('A');
    await tick();
    expect(pending).toHaveLength(1);
    value = 'C';
    changed();
    changed();
    pending.shift()!();
    await tick();
    expect(live.getSnapshot().data).toBe('B');
    expect(pending).toHaveLength(1);
    pending.shift()!();
    await tick();
    expect(live.getSnapshot().data).toBe('C');
    expect(pending).toHaveLength(0);
    live.dispose();
  });
});

describe('combineLiveQueries', () => {
  it('opens when every part has, then follows each', async () => {
    const a = source(1);
    const b = source(10);
    const live = combineLiveQueries([createLiveQuery(a), createLiveQuery(b)], ([x, y]) => x + y);
    expect(await live.first).toBe(11);
    expect(live.getSnapshot().initial).toBe(true);
    b.set(20);
    await tick();
    expect(live.getSnapshot()).toMatchObject({ data: 21, initial: false });
    live.dispose();
  });

  it('fails when a part fails to open', async () => {
    const bad = createLiveQuery<number>({
      read: () => Promise.reject(new Error('down')),
      watch: () => () => undefined,
    });
    const live = combineLiveQueries([createLiveQuery(source(1)), bad], ([x, y]) => x + y);
    await expect(live.first).rejects.toThrow('down');
  });

  it('opens on combine([]) with no parts', async () => {
    const live = combineLiveQueries<number, number[]>([], (data) => data);
    expect(await live.first).toEqual([]);
  });

  it('fails when combine throws on the opening result', async () => {
    const live = combineLiveQueries([createLiveQuery(source(1))], () => {
      throw new Error('combine');
    });
    await expect(live.first).rejects.toThrow('combine');
  });

  it('gives the combiner a copy, so one that reorders its argument leaves the parts in place', async () => {
    const a = source(1);
    const b = source(10);
    const live = combineLiveQueries([createLiveQuery(a), createLiveQuery(b)], (data) =>
      data.sort((x, y) => y - x).reduce((sum, n) => sum + n, 0),
    );
    expect(await live.first).toBe(11);
    a.set(2);
    await tick();
    expect(live.getSnapshot().data).toBe(12);
    live.dispose();
  });
});

describe('mapLiveQuery', () => {
  it('maps the first result and each change, and disposing it disposes the source', async () => {
    let changed!: () => void;
    let value = 1;
    const source = createLiveQuery({
      read: () => value,
      watch: (cb) => {
        changed = cb;
        return () => undefined;
      },
    });
    const mapped = mapLiveQuery(source, async (n) => n * 10);
    const seen: { data?: number; initial: boolean }[] = [];
    mapped.subscribe((s) => seen.push({ data: s.data, initial: s.initial }));

    expect(await mapped.first).toBe(10);
    value = 2;
    changed();
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual([
      { data: 10, initial: true },
      { data: 20, initial: false },
    ]);

    mapped.dispose();
    expect(source.getSnapshot().status).toBe('ready');
    value = 3;
    changed();
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toHaveLength(2);
  });

  it('fails when the map throws before the first result', async () => {
    const source = createLiveQuery({ read: () => 1, watch: () => () => undefined });
    const mapped = mapLiveQuery(source, () => {
      throw new Error('no');
    });
    await expect(mapped.first).rejects.toThrow('no');
  });

  it('does not start a queued map once the mapped handle is disposed', async () => {
    const src = source(1);
    let release!: () => void;
    const started: number[] = [];
    const mapped = mapLiveQuery(createLiveQuery(src), (n) => {
      started.push(n);
      return new Promise<number>((resolve) => (release = () => resolve(n)));
    });
    await tick();
    src.set(2); // queued behind the map of 1, which has not finished
    await tick();
    mapped.dispose();
    release();
    await tick();
    expect(started).toEqual([1]);
  });
});
