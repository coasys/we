/**
 * The two halves of a reaction meeting: what is held on the press, and what releases it.
 *
 * `@we/optimism` proves the rules in isolation. What is left here is the composition — which rows
 * are reported, and what an empty list is allowed to mean.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { signalOptimism } from '../src/shared/signalOptimism';

const me = 'did:me';
const held = () => signalOptimism.overlay().find((entry) => entry.record === 'post-1' && entry.type === 'st-like');

beforeEach(() => signalOptimism.reset());

describe('a reaction in flight', () => {
  it('is drawn from the press', () => {
    signalOptimism.hold('post-1', 'st-like', 1);
    expect(held()).toMatchObject({ value: 1 });
  });

  it('is withdrawn when the write is refused', () => {
    signalOptimism.hold('post-1', 'st-like', 1);
    signalOptimism.release('post-1', 'st-like');
    expect(held()).toBeUndefined();
  });

  it('survives the draw that holding it caused, and goes on the one that answered', () => {
    signalOptimism.hold('post-1', 'st-like', 1);
    signalOptimism.done('post-1', 'st-like');

    // The draw the press itself caused, made from rows that still say nothing — the baseline.
    signalOptimism.settleFromSignals('post-1', me, [{ author: 'did:them', signalTypeId: 'st-like', value: 1 }]);
    expect(held()).toMatchObject({ value: 1 });

    // The push that answered.
    signalOptimism.settleFromSignals('post-1', me, [
      { author: 'did:them', signalTypeId: 'st-like', value: 1 },
      { author: me, signalTypeId: 'st-like', value: 1 },
    ]);
    expect(held()).toBeUndefined();
  });

  it('is not released by a record whose reactions have not arrived', () => {
    /*
      An empty list read as data says this agent has not reacted — so a hold for a reaction reads as
      overtaken and the mark falls back to rows that do not have the write in them yet. The same rule
      `involvementOptimism.settleFromRows` records.
    */
    signalOptimism.hold('post-1', 'st-like', 1);
    signalOptimism.done('post-1', 'st-like');
    signalOptimism.settleFromSignals('post-1', me, []);
    expect(held()).toMatchObject({ value: 1 });
  });

  it('says nothing about a record it was not asked about', () => {
    signalOptimism.hold('post-1', 'st-like', 1);
    signalOptimism.done('post-1', 'st-like');
    signalOptimism.settleFromSignals('post-2', me, [{ author: me, signalTypeId: 'st-like', value: 1 }]);
    expect(held()).toMatchObject({ value: 1 });
  });

  it('settles a withdrawal against the reaction being gone', () => {
    // A zero is a delete, so what proves it landed is this agent having no row of that type.
    signalOptimism.hold('post-1', 'st-like', 0);
    signalOptimism.done('post-1', 'st-like');
    signalOptimism.settleFromSignals('post-1', me, [{ author: me, signalTypeId: 'st-like', value: 1 }]);
    expect(held()).toMatchObject({ value: 0 });

    signalOptimism.settleFromSignals('post-1', me, [{ author: 'did:them', signalTypeId: 'st-like', value: 1 }]);
    expect(held()).toBeUndefined();
  });

  it('holds each type apart on one record', () => {
    signalOptimism.hold('post-1', 'st-like', 1);
    signalOptimism.hold('post-1', 'st-star', 4);
    signalOptimism.done('post-1', 'st-like');
    signalOptimism.done('post-1', 'st-star');

    // The like lands; the star has not. One settling must not retire the other.
    signalOptimism.settleFromSignals('post-1', me, [{ author: me, signalTypeId: 'st-like', value: 1 }]);
    expect(held()).toBeUndefined();
    expect(signalOptimism.overlay().find((entry) => entry.type === 'st-star')).toMatchObject({ value: 4 });
  });
});
