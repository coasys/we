/**
 * Following a graph read — what `GraphHost.watch` does with the subscription it opens.
 *
 * The graph reads its seeds with `findAll` and subscribes afterwards, so a write that lands between
 * the two is in the subscription's first answer and in no callback. Seen on staging: the read came
 * back with 0 rows, the subscription's first answer 0.34 s later had 7, and the graph only showed
 * them because an unrelated change arrived later.
 */
import { describe, expect, it, vi } from 'vitest';

import { followRead, type LiveRead } from '../src/shared/graphWatch';

/** A subscription that answers `initial` and calls back only when the test says so. */
function liveRead(initial: { id: string }[]) {
  let callback: ((rows: { id: string }[]) => void) | undefined;
  let resolve!: (rows: { id: string }[]) => void;
  const answered = new Promise<{ id: string }[]>((r) => (resolve = r));
  const subscription: LiveRead<{ id: string }> = {
    subscribe(cb) {
      callback = cb;
      return answered;
    },
    dispose: vi.fn(),
  };
  return {
    subscription,
    answer: async () => {
      resolve(initial);
      await answered;
      await Promise.resolve();
    },
    change: (rows: { id: string }[]) => callback?.(rows),
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

  it('reports a change that arrived before the first answer once, not twice', async () => {
    const read = liveRead([{ id: 'a' }]);
    const onChange = vi.fn();
    followRead(read.subscription, { seen: () => [], onChange, onError: vi.fn() });

    read.change([{ id: 'a' }]);
    await read.answer();
    await settle();

    expect(onChange).toHaveBeenCalledTimes(1);
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
});
