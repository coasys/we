/**
 * Following a graph read — what `GraphHost.watch` does with the subscription it opens.
 *
 * The graph reads its seeds with `findAll` and subscribes afterwards, so a write that lands between
 * the two is in the subscription's first answer and in no callback. Seen on staging: the read came
 * back with 0 rows, the subscription's first answer 0.34 s later had 7, and the graph only showed
 * them because an unrelated change arrived later.
 */
import { describe, expect, it, vi } from 'vitest';

import { followRead, type LiveRead, wholeAnswer } from '../src/shared/graphWatch';

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
