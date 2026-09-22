/**
 * The order a record's reactions settle into, and why it cannot live in the template.
 *
 * It did, as a `$localState` initial — evaluated at mount and never again, which reads like exactly
 * the right semantics. What defeats it is that a reaction surface is drawn inside an `$each` over a
 * query: a subscription answers with a fresh array of fresh objects, Solid's keyed `<For>` therefore
 * remounts every row, and writing a reaction re-runs the very query that feeds the row it was
 * written on. So the snapshot was re-taken on precisely the events it existed to be stable across.
 *
 * These are about what holding it instead has to guarantee.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { signalOrder } from '../src/shared/signalOrder';

/** Deferred releases, run when a test says so rather than whenever a microtask happens to land. */
let deferred: (() => void)[] = [];
const run = () => {
  const queued = deferred;
  deferred = [];
  queued.forEach((work) => work());
};

beforeEach(() => {
  signalOrder.reset();
  deferred = [];
  signalOrder.scheduleWith((work) => deferred.push(work));
});

describe('a record keeps the order it was first drawn in', () => {
  it('hands back what was settled, however many times it is asked', () => {
    signalOrder.settle('post-1', ['like', 'stars', 'vote']);
    expect(signalOrder.held('post-1')).toEqual(['like', 'stars', 'vote']);
    expect(signalOrder.held('post-1')).toEqual(['like', 'stars', 'vote']);
  });

  it('knows nothing about a record it has not drawn', () => {
    // Which is how a first draw gets the live order — there is nothing to hold it to yet.
    expect(signalOrder.held('post-2')).toBeUndefined();
  });

  it('keeps one record’s order out of another’s', () => {
    signalOrder.settle('post-1', ['like', 'stars']);
    signalOrder.settle('post-2', ['stars', 'like']);
    expect(signalOrder.held('post-1')).toEqual(['like', 'stars']);
    expect(signalOrder.held('post-2')).toEqual(['stars', 'like']);
  });

  it('forgets everything when the space is left', () => {
    // With the optimism holds, and for the same reason: a hold is a promise about records on the
    // screen being left.
    signalOrder.settle('post-1', ['like']);
    signalOrder.reset();
    expect(signalOrder.held('post-1')).toBeUndefined();
  });
});

describe('an order lives as long as something is drawing it', () => {
  it('survives a release that is immediately followed by another draw', () => {
    /*
      The case the deferral exists for, and the one that breaks every simpler design.

      A subscription answers by handing the renderer a fresh array of fresh objects, so Solid's
      keyed `<For>` disposes the row and builds a new one — inside a single batch. Releasing on
      disposal would therefore forget the order on exactly the events it exists to be stable across,
      which is what writing a reaction does to the row it was written on.
    */
    signalOrder.settle('post-1', ['like', 'stars']);
    signalOrder.release('post-1');
    // The row is rebuilt before the tick ends and asks for the order again.
    expect(signalOrder.held('post-1')).toEqual(['like', 'stars']);

    run();
    expect(signalOrder.held('post-1'), 'a remount lost the order it was settled with').toEqual(['like', 'stars']);
  });

  it('forgets a record nothing asked about again', () => {
    // Selecting another card. Nothing draws this one until it is selected again, and then it
    // settles fresh — which is what makes "most used first" true when a card is opened.
    signalOrder.settle('post-1', ['like', 'stars']);
    signalOrder.release('post-1');
    run();
    expect(signalOrder.held('post-1')).toBeUndefined();
  });

  it('forgets it even after several rebuilds, once the rebuilds stop', () => {
    // Each pass releases and re-asks; the last one releases and nothing follows.
    for (let pass = 0; pass < 3; pass += 1) {
      signalOrder.settle('post-1', ['like']);
      signalOrder.release('post-1');
      run();
    }
    expect(signalOrder.held('post-1')).toBeUndefined();
  });

  it('leaves the records still being drawn alone', () => {
    // A feed draws many at once and only the row somebody reacted on is rebuilt. Nothing about that
    // row is a statement about the others.
    signalOrder.settle('post-1', ['like']);
    signalOrder.settle('post-2', ['stars']);
    signalOrder.release('post-1');
    run();
    expect(signalOrder.held('post-1')).toBeUndefined();
    expect(signalOrder.held('post-2')).toEqual(['stars']);
  });
});
