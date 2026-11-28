/**
 * Following a graph read — what `GraphHost.watch` does with the subscription it opens.
 *
 * The graph reads its seeds with `findAll` and subscribes afterwards, so a write that lands between
 * the two is in the subscription's first answer and in no callback. Seen on staging: the read came
 * back with 0 rows, the subscription's first answer 0.34 s later had 7, and the graph only showed
 * them because an unrelated change arrived later.
 */
import { describe, expect, it, vi } from 'vitest';

import { followRead, type LiveRead, readThroughWatch, wholeAnswer } from '../src/shared/graphWatch';

type Row = { id: string };
type Snapshot = { status: 'ready'; data: { results: Row[] }; initial: boolean };

/** A live query that opens on `initial` when the test says so, and changes only when the test says so. */
function liveRead(initial: Row[]) {
  const listeners = new Set<(snapshot: Snapshot) => void>();
  let current: Snapshot | undefined;
  let resolve!: (page: { results: Row[] }) => void;
  let reject!: (error: Error) => void;
  const first = new Promise<{ results: Row[] }>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const emit = (rows: Row[], isInitial: boolean) => {
    current = { status: 'ready', data: { results: rows }, initial: isInitial };
    for (const fn of [...listeners]) fn(current);
  };
  const subscription: LiveRead<Row> = {
    first,
    subscribe(fn) {
      listeners.add(fn as (snapshot: Snapshot) => void);
      if (current) fn(current as never);
      return () => void listeners.delete(fn as (snapshot: Snapshot) => void);
    },
    dispose: vi.fn(),
  };
  return {
    subscription,
    answer: async () => {
      emit(initial, true);
      resolve({ results: initial });
      await first;
    },
    change: (rows: Row[]) => emit(rows, false),
    fail: (error: Error) => reject(error),
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('followRead', () => {
  it('reports a change when the first answer has rows the read did not', async () => {
    const read = liveRead([{ id: 'a' }, { id: 'b' }]);
    const onChange = vi.fn();
    followRead(read.subscription, { seen: () => [], onChange, onError: vi.fn() });

    await read.answer();
    await settle();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('reports nothing when the first answer is what the read saw, in any order', async () => {
    const read = liveRead([{ id: 'b' }, { id: 'a' }]);
    const onChange = vi.fn();
    followRead(read.subscription, { seen: () => ['a', 'b'], onChange, onError: vi.fn() });

    await read.answer();
    await settle();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports every change after the first answer', async () => {
    const read = liveRead([{ id: 'a' }]);
    const onChange = vi.fn();
    followRead(read.subscription, { seen: () => ['a'], onChange, onError: vi.fn() });

    await read.answer();
    read.change([{ id: 'a' }, { id: 'b' }]);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('reports nothing once stopped, and lets the subscription go', async () => {
    const read = liveRead([{ id: 'a' }]);
    const onChange = vi.fn();
    const stop = followRead(read.subscription, { seen: () => [], onChange, onError: vi.fn() });

    stop();
    await read.answer();
    read.change([{ id: 'a' }, { id: 'b' }]);
    await settle();

    expect(onChange).not.toHaveBeenCalled();
    expect(read.subscription.dispose).toHaveBeenCalledTimes(1);
  });

  it('reports nothing for a read it cannot compare with', async () => {
    // No read recorded for this question: the old behaviour, so a watch with nothing to compare
    // does not refresh the graph on every open.
    const read = liveRead([{ id: 'a' }]);
    const onChange = vi.fn();
    followRead(read.subscription, { seen: () => undefined, onChange, onError: vi.fn() });

    await read.answer();
    await settle();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports a failure to open', async () => {
    const read = liveRead([]);
    const onError = vi.fn();
    followRead(read.subscription, { seen: () => [], onChange: vi.fn(), onError });

    read.fail(new Error('refused'));
    await settle();

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'refused' }));
  });
});

describe('handing the new answer over', () => {
  it('passes the page a change brought', async () => {
    const read = liveRead([{ id: 'a' }]);
    const onChange = vi.fn();
    followRead(read.subscription, { seen: () => ['a'], onChange, onError: vi.fn() });
    await read.answer();

    read.change([{ id: 'a' }, { id: 'b' }]);

    expect(onChange).toHaveBeenCalledWith({ results: [{ id: 'a' }, { id: 'b' }] });
  });

  it('takes a page as the whole answer only when nothing is left out of it', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    // Uncounted, or counted and all here.
    expect(wholeAnswer({ results: rows }, undefined)).toBe(rows);
    expect(wholeAnswer({ results: rows, totalCount: 2 }, undefined)).toBe(rows);
    // Counted and short: a page of something larger.
    expect(wholeAnswer({ results: rows, totalCount: 5 }, undefined)).toBeUndefined();
    expect(wholeAnswer({ results: rows, totalCount: 5 }, 10)).toBeUndefined();
    // Short of the count, but everything the read asked for.
    expect(wholeAnswer({ results: rows, totalCount: 5 }, 2)).toBe(rows);
  });
});

describe('readThroughWatch', () => {
  /*
    A graph used to read with `findAll` and then open a watch on the same question, whose first act
    on the backend is to run that question again. Reading through the watch asks once.
  */
  const options = (overrides: Partial<Parameters<typeof readThroughWatch<Row>>[1]> = {}) => {
    const reads: { rows: readonly Row[]; through: string }[] = [];
    const changes: unknown[] = [];
    const complete = vi.fn(async () => [{ id: 'from-findAll' }]);
    return {
      reads,
      changes,
      complete,
      value: {
        limit: undefined,
        complete,
        onRead: (rows: readonly Row[], through: 'watch' | 'read') => reads.push({ rows, through }),
        seen: () => reads.at(-1)?.rows.map((row) => row.id),
        onChange: (page: unknown) => changes.push(page),
        onError: () => undefined,
        ...overrides,
      },
    };
  };

  it('answers the read from the watch’s first page, without asking again', async () => {
    const live = liveRead([{ id: 'a' }, { id: 'b' }]);
    const opts = options();
    const { rows } = readThroughWatch(live.subscription, opts.value);
    await live.answer();

    expect(await rows).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(opts.complete).not.toHaveBeenCalled();
    expect(opts.reads.map((read) => read.through)).toEqual(['watch']);
    // The first page is the read itself, not a change to it.
    expect(opts.changes).toEqual([]);
  });

  it('asks the ordinary way when the first page is only part of the answer', async () => {
    const first = Promise.resolve({ results: [{ id: 'a' }], totalCount: 5 });
    const subscription: LiveRead<Row> = { first, subscribe: () => () => undefined, dispose: vi.fn() };
    const opts = options({ limit: 100 });

    expect(await readThroughWatch(subscription, opts.value).rows).toEqual([{ id: 'from-findAll' }]);
    expect(opts.reads.map((read) => read.through)).toEqual(['read']);
  });

  it('asks the ordinary way when the watch will not open', async () => {
    const live = liveRead([]);
    const opts = options();
    const { rows } = readThroughWatch(live.subscription, opts.value);
    live.fail(new Error('refused'));

    expect(await rows).toEqual([{ id: 'from-findAll' }]);
  });

  it('reports a change after the first page, and stops when told', async () => {
    const live = liveRead([{ id: 'a' }]);
    const opts = options();
    const { rows, stop } = readThroughWatch(live.subscription, opts.value);
    await live.answer();
    await rows;

    live.change([{ id: 'a' }, { id: 'c' }]);
    expect(opts.changes).toEqual([{ results: [{ id: 'a' }, { id: 'c' }] }]);

    stop();
    expect(live.subscription.dispose).toHaveBeenCalled();
  });
});
