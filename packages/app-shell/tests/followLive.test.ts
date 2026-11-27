/**
 * Following a live query from a store — `followLive` and `followRows` — under each reactivity port.
 *
 * The handle is a hand-driven stand-in with the contract's shape: it opens, pushes pages, or fails to
 * open when the test says so, and records whether it was disposed. What is under test is the follow:
 * what it applies, when it says the rows are in, the stored read it falls back on, and that nothing
 * for an input the owner has moved on from lands.
 */
import type { LivePage, LiveQuery, Snapshot } from '@we/backend-shared';
import type { ReactivityPort } from '@we/reactivity';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { followLive, followRows } from '../src/shared/followLive';
import { reactivityPorts } from './support/engines';

interface Handle<T> extends LiveQuery<LivePage<T>> {
  push(rows: T[]): void;
  failOpen(error: Error): void;
  readonly disposed: boolean;
  readonly listening: number;
}

function handle<T>(): Handle<T> {
  let snapshot: Snapshot<LivePage<T>> = { status: 'loading', initial: false };
  const listeners = new Set<(s: Snapshot<LivePage<T>>) => void>();
  let disposed = false;
  let resolveFirst!: (page: LivePage<T>) => void;
  let rejectFirst!: (error: Error) => void;
  const first = new Promise<LivePage<T>>((resolve, reject) => {
    resolveFirst = resolve;
    rejectFirst = reject;
  });
  first.catch(() => undefined);
  const publish = (next: Snapshot<LivePage<T>>) => {
    snapshot = next;
    for (const fn of [...listeners]) fn(next);
  };
  return {
    first,
    getSnapshot: () => snapshot,
    subscribe: (fn) => {
      if (disposed) return () => undefined;
      listeners.add(fn);
      if (snapshot.status !== 'loading') fn(snapshot);
      return () => void listeners.delete(fn);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      if (snapshot.status === 'loading') rejectFirst(new Error('disposed'));
    },
    push(rows) {
      if (disposed) return;
      const opening = snapshot.status === 'loading';
      if (opening) resolveFirst({ results: rows });
      publish({ status: 'ready', data: { results: rows }, initial: opening });
    },
    failOpen(error) {
      rejectFirst(error);
      publish({ status: 'error', error, initial: false });
      disposed = true;
      listeners.clear();
    },
    get disposed() {
      return disposed;
    },
    get listening() {
      return listeners.size;
    },
  };
}

/** Let every queued promise callback run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A promise and its resolvers, for an open, a map or a read the test finishes by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe.each(reactivityPorts)('following a live query, under %s', (_name, makePort) => {
  let port: ReactivityPort;
  const disposers: (() => void)[] = [];
  const own = (fn: () => void) => disposers.push(port.root(fn));

  beforeEach(() => {
    port = makePort();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    vi.restoreAllMocks();
  });

  describe('followLive', () => {
    it('applies the page it opened on, then each change, and says the rows are in once', async () => {
      const live = handle<string>();
      const applied: [string[], boolean][] = [];
      const settled = vi.fn();
      own(() => followLive(port, live, { store: 'S', what: 'x', apply: (v, i) => applied.push([v, i]), settled }));

      live.push(['a']);
      live.push(['a', 'b']);
      await settle();
      expect(applied).toEqual([
        [['a'], true],
        [['a', 'b'], false],
      ]);
      expect(settled).toHaveBeenCalledTimes(1);
      expect(settled).toHaveBeenCalledWith(true, undefined);
    });

    it('disposes the handle with its owner, and applies nothing after', async () => {
      const live = handle<string>();
      const apply = vi.fn();
      const dispose = port.root(() => followLive(port, live, { store: 'S', what: 'x', apply }));
      dispose();
      expect(live.disposed).toBe(true);
      live.push(['late']);
      await settle();
      expect(apply).not.toHaveBeenCalled();
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('supersedes the follow for an old input when the input changes', async () => {
      const [input, setInput] = port.signal('one');
      const handles: Record<string, Handle<string>> = { one: handle(), two: handle() };
      const applied: string[][] = [];
      own(() =>
        port.effect(() => {
          const key = input();
          followLive(port, handles[key], { store: 'S', what: 'x', apply: (v) => applied.push(v) });
        }),
      );
      await settle();
      setInput('two');
      expect(handles.one.disposed).toBe(true);
      handles.one.push(['from one']);
      handles.two.push(['from two']);
      await settle();
      expect(applied).toEqual([['from two']]);
    });

    it('never follows a handle opened after the follow was superseded', async () => {
      const [input, setInput] = port.signal(1);
      const opening = deferred<Handle<string> | undefined>();
      const late = handle<string>();
      const settled = vi.fn();
      own(() =>
        port.effect(() => {
          if (input() !== 1) return;
          followLive(port, () => opening.promise, { store: 'S', what: 'x', apply: vi.fn(), settled });
        }),
      );
      await settle();
      setInput(2);
      opening.resolve(late);
      await settle();
      expect(late.disposed).toBe(true);
      expect(late.listening).toBe(0);
      expect(settled).not.toHaveBeenCalled();
    });

    it('hands the opener whether it is still current, so it can skip opening', async () => {
      const [input, setInput] = port.signal(1);
      const before = deferred<void>();
      let currentAfterWait: boolean | undefined;
      own(() =>
        port.effect(() => {
          if (input() !== 1) return;
          followLive(
            port,
            async (current) => {
              await before.promise;
              currentAfterWait = current();
              return undefined;
            },
            { store: 'S', what: 'x', apply: vi.fn() },
          );
        }),
      );
      await settle();
      setInput(2);
      before.resolve();
      await settle();
      expect(currentAfterWait).toBe(false);
    });

    it('reads the stored rows once when the handle cannot open, and says so', async () => {
      const live = handle<string>();
      const applied: [string[], boolean][] = [];
      const settled = vi.fn();
      const read = vi.fn(async () => ['stored']);
      own(() =>
        followLive(port, live, {
          store: 'S',
          what: 'x',
          apply: (v, i) => applied.push([v, i]),
          stored: { read },
          settled,
        }),
      );
      const why = new Error('no watch');
      live.failOpen(why);
      await settle();
      expect(read).toHaveBeenCalledTimes(1);
      expect(applied).toEqual([[['stored'], true]]);
      expect(settled).toHaveBeenCalledWith(true, why);
      expect(console.warn).toHaveBeenCalledWith('S: could not watch x', why);
    });

    it('applies stored rows through their own apply when one is given', async () => {
      const live = handle<string>();
      const apply = vi.fn();
      const storedApply = vi.fn();
      own(() =>
        followLive(port, live, {
          store: 'S',
          what: 'x',
          apply,
          stored: { read: async () => ['stored'], apply: storedApply },
        }),
      );
      live.failOpen(new Error('no watch'));
      await settle();
      expect(apply).not.toHaveBeenCalled();
      expect(storedApply).toHaveBeenCalledWith(['stored']);
    });

    it('is not loaded when the stored read fails too', async () => {
      const live = handle<string>();
      const settled = vi.fn();
      const apply = vi.fn();
      own(() =>
        followLive(port, live, {
          store: 'S',
          what: 'x',
          apply,
          stored: { read: () => Promise.reject(new Error('no read')) },
          settled,
        }),
      );
      const why = new Error('no watch');
      live.failOpen(why);
      await settle();
      expect(apply).not.toHaveBeenCalled();
      expect(settled).toHaveBeenCalledWith(false, why);
    });

    it('drops a stored read that answers after the follow was superseded', async () => {
      const live = handle<string>();
      const reading = deferred<string[]>();
      const apply = vi.fn();
      const settled = vi.fn();
      const dispose = port.root(() =>
        followLive(port, live, { store: 'S', what: 'x', apply, stored: { read: () => reading.promise }, settled }),
      );
      live.failOpen(new Error('no watch'));
      await settle();
      dispose();
      reading.resolve(['too late']);
      await settle();
      expect(apply).not.toHaveBeenCalled();
      expect(settled).not.toHaveBeenCalled();
    });

    it('treats an opener that throws as a failure with nothing to fall back on', async () => {
      const read = vi.fn(async () => ['stored']);
      const settled = vi.fn();
      own(() =>
        followLive<string>(
          port,
          async () => {
            throw new Error('no shape');
          },
          { store: 'S', what: 'x', apply: vi.fn(), stored: { read }, settled },
        ),
      );
      await settle();
      expect(read).not.toHaveBeenCalled();
      expect(settled).toHaveBeenCalledWith(false, new Error('no shape'));
    });

    it('applies async maps newest last, and is loaded only once the newest is in', async () => {
      const live = handle<string>();
      const maps: Record<string, ReturnType<typeof deferred<string>>> = {};
      const applied: string[] = [];
      const settled = vi.fn();
      own(() =>
        followLive(port, live, {
          store: 'S',
          what: 'x',
          map: (rows) => (maps[rows[0]] = deferred<string>()).promise,
          apply: (v) => applied.push(v),
          settled,
        }),
      );
      live.push(['old']);
      live.push(['new']);
      await settle();
      maps.new.resolve('NEW');
      await settle();
      expect(settled).toHaveBeenCalledWith(true, undefined);
      // The older page finishing after the newer must not put it back.
      maps.old.resolve('OLD');
      await settle();
      expect(applied).toEqual(['NEW']);
    });

    it('drops a page whose map finishes after the follow was superseded', async () => {
      const live = handle<string>();
      const mapping = deferred<string>();
      const apply = vi.fn();
      const settled = vi.fn();
      const dispose = port.root(() =>
        followLive(port, live, { store: 'S', what: 'x', map: () => mapping.promise, apply, settled }),
      );
      live.push(['a']);
      await settle();
      dispose();
      mapping.resolve('A');
      await settle();
      expect(apply).not.toHaveBeenCalled();
      expect(settled).not.toHaveBeenCalled();
    });

    it('falls back to the stored rows when the newest page cannot be mapped', async () => {
      const live = handle<string>();
      const applied: string[] = [];
      const settled = vi.fn();
      own(() =>
        followLive(port, live, {
          store: 'S',
          what: 'x',
          map: () => Promise.reject(new Error('cannot map')),
          apply: (v) => applied.push(v),
          stored: { read: async () => 'stored' },
          settled,
        }),
      );
      live.push(['a']);
      await settle();
      expect(applied).toEqual(['stored']);
      expect(settled).toHaveBeenCalledWith(true, undefined);
      expect(console.warn).toHaveBeenCalledWith('S: could not read x', new Error('cannot map'));
    });
  });

  describe('followRows', () => {
    it('holds the rows, loaded and error for the current input', async () => {
      const [input, setInput] = port.signal<string | undefined>(undefined);
      const handles: Record<string, Handle<string>> = { one: handle(), two: handle() };
      let rows!: ReturnType<typeof followRows<string, string>>;
      own(() => {
        rows = followRows(port, input, {
          store: 'S',
          what: 'x',
          open: (key) => handles[key],
          readStored: async (key) => [`stored ${key}`],
        });
      });
      await settle();
      // No input: nothing to wait for.
      expect(rows.loaded()).toBe(true);
      expect(rows.rows()).toEqual([]);

      setInput('one');
      expect(rows.loaded()).toBe(false);
      handles.one.push(['a']);
      expect(rows.rows()).toEqual(['a']);
      expect(rows.loaded()).toBe(true);

      setInput('two');
      expect(handles.one.disposed).toBe(true);
      expect(rows.rows()).toEqual([]);
      expect(rows.loaded()).toBe(false);
      const why = new Error('no watch');
      handles.two.failOpen(why);
      await settle();
      expect(rows.rows()).toEqual(['stored two']);
      expect(rows.loaded()).toBe(true);
      expect(rows.error()).toBe(why);
    });

    it('wakes a reader once for a page, not once per signal it sets', async () => {
      const live = handle<string>();
      let rows!: ReturnType<typeof followRows<string, string>>;
      const seen: [string[], boolean][] = [];
      own(() => {
        rows = followRows(port, () => 'k', { store: 'S', what: 'x', open: () => live });
        port.effect(() => void seen.push([rows.rows(), rows.loaded()]));
      });
      await settle();
      const before = seen.length;
      live.push(['a']);
      expect(seen.slice(before)).toEqual([[['a'], true]]);
    });
  });
});
