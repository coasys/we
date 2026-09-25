/**
 * What serialising a read-then-write has to guarantee.
 *
 * The bug behind it: two `upsertSignal` calls for one reaction both read before either wrote, so
 * both found the same stored record, both deleted it, and both created a replacement — one person
 * listed twice under one signal type, with the same value, and no later change able to repair it
 * because the lookup only ever reaches the first.
 *
 * So the first test is the one that matters: two calls under one key must not overlap. The rest pin
 * the things a naive queue gets wrong — different keys still running at once, and a failure not
 * wedging the key it failed on.
 */
import { describe, expect, it } from 'vitest';

import { oneAtATime } from '../src/shared/oneAtATime';

/** A promise with its settle functions to hand, so a test decides when a "write" finishes. */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('one write at a time, per key', () => {
  it('does not start the second until the first has finished', async () => {
    const queue = oneAtATime();
    const first = deferred<string>();
    const events: string[] = [];

    const a = queue('post|like', async () => {
      events.push('a:start');
      const value = await first.promise;
      events.push('a:end');
      return value;
    });
    const b = queue('post|like', async () => {
      events.push('b:start');
      return 'b';
    });

    // The whole bug in one assertion: b must not have read anything yet.
    await Promise.resolve();
    expect(events).toEqual(['a:start']);

    first.resolve('a');
    await Promise.all([a, b]);
    expect(events).toEqual(['a:start', 'a:end', 'b:start']);
  });

  it('runs three in the order they were asked for', async () => {
    // A "busy" flag instead of a chain passes the test above and fails this one: once the first
    // finishes, the two waiting behind it both start.
    const queue = oneAtATime();
    const done: number[] = [];
    await Promise.all([1, 2, 3].map((n) => queue('one|pair', async () => void done.push(n))));
    expect(done).toEqual([1, 2, 3]);
  });

  it('lets different keys run at the same time', async () => {
    // Reacting to one post must not wait on a reaction to another: the invariant is about one pair,
    // and a global queue would be a throughput cost for no correctness gain.
    const queue = oneAtATime();
    const held = deferred<void>();
    let otherRan = false;

    void queue('post-a|like', () => held.promise);
    await queue('post-b|like', async () => {
      otherRan = true;
    });

    expect(otherRan).toBe(true);
    held.resolve();
  });

  it('carries a failure to its own caller and nobody else', async () => {
    const queue = oneAtATime();

    await expect(
      queue('post|star', async () => {
        throw new Error('refused');
      }),
    ).rejects.toThrow('refused');

    // The next write of the same reaction is unrelated to why the last was refused. A chain built
    // on the rejected promise would reject this too, and every call after it, for good.
    await expect(queue('post|star', async () => 'fine')).resolves.toBe('fine');
  });

  it('does not report a queued failure as unhandled', async () => {
    /*
      The chain a later call waits on is the SETTLED tail rather than the work itself. Without that
      the runtime sees a rejected promise nothing is attached to and reports it — a console error on
      an ordinary refused write, which is the kind of noise that teaches people to ignore the console.
    */
    const queue = oneAtATime();
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown) => seen.push(reason);
    process.on('unhandledRejection', onUnhandled);

    await expect(queue('k', () => Promise.reject(new Error('nope')))).rejects.toThrow('nope');
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off('unhandledRejection', onUnhandled);

    expect(seen).toEqual([]);
  });

  it('forgets a key once its chain has drained', async () => {
    // A queue over every record somebody has ever reacted to would otherwise keep an entry each.
    const queue = oneAtATime();
    await queue('post|like', async () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const events: string[] = [];
    const held = deferred<void>();
    void queue('post|like', async () => {
      events.push('start');
      await held.promise;
    });
    await Promise.resolve();
    // Still serialising after the cleanup — the entry going does not mean the guard has gone.
    void queue('post|like', async () => void events.push('second'));
    await Promise.resolve();
    expect(events).toEqual(['start']);
    held.resolve();
  });
});
