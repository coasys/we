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

beforeEach(() => signalOrder.reset());

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

describe('it does not grow forever', () => {
  it('drops the least recently drawn once it is full', () => {
    /*
      A session spent scrolling a feed would otherwise accumulate an entry per record ever drawn.
      Least recently DRAWN rather than oldest: a record nobody has looked at in five hundred others
      is one whose order nobody is watching, where the first record of the session may well still be
      on screen.
    */
    for (let n = 0; n < 500; n += 1) signalOrder.settle(`post-${n}`, ['like']);
    expect(signalOrder.size()).toBe(500);

    // Reading one counts as drawing it, so it outlives the ones it was inserted before.
    expect(signalOrder.held('post-0')).toEqual(['like']);
    signalOrder.settle('post-500', ['stars']);

    expect(signalOrder.size()).toBe(500);
    expect(signalOrder.held('post-0'), 'the one being read was evicted').toEqual(['like']);
    expect(signalOrder.held('post-1'), 'the least recently drawn survived').toBeUndefined();
  });
});
