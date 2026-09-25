/**
 * A subscription that starts after its owner has gone still has to be stopped.
 *
 * The staged-suggestion watch moved from link listeners, which registered within a microtask, to an
 * executor subscription, which takes a round trip to start. A space switch inside that round trip ran
 * the store's cleanup before the stop function existed, and the subscription — with its keepalive —
 * ran for the life of the app, re-reading proposals for whichever space was open whenever the old
 * one's changed.
 */
import { holdSubscription } from '@shared/utils';
import { describe, expect, it, vi } from 'vitest';

function deferred() {
  let resolve!: (off: () => void) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<() => void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('holding a subscription', () => {
  it('stops one that starts after the owner released it', async () => {
    const start = deferred();
    const off = vi.fn();
    const release = holdSubscription(start.promise, vi.fn());

    release();
    start.resolve(off);
    await settle();

    expect(off).toHaveBeenCalledOnce();
  });

  it('stops one that started earlier when the owner releases it, once', async () => {
    const start = deferred();
    const off = vi.fn();
    const release = holdSubscription(start.promise, vi.fn());

    start.resolve(off);
    await settle();
    expect(off).not.toHaveBeenCalled();

    release();
    release();
    expect(off).toHaveBeenCalledOnce();
  });

  it('reports one that fails to start, and releases without it', async () => {
    const start = deferred();
    const onError = vi.fn();
    const release = holdSubscription(start.promise, onError);

    start.reject(new Error('unsupported'));
    await settle();

    expect(onError).toHaveBeenCalledOnce();
    expect(() => release()).not.toThrow();
  });

  it('accepts a runtime that offers no subscription', () => {
    expect(() => holdSubscription(undefined, vi.fn())()).not.toThrow();
  });
});
