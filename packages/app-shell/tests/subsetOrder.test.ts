/**
 * A drag made while looking at part of a column must not move the cards nobody could see.
 *
 * The failure this exists to prevent is silent and shared: writing the visible order followed by
 * everything else sends every hidden card to the bottom of the column, on every board, for everyone.
 */
import { describe, expect, it } from 'vitest';

import { spliceSubsetOrder } from '../src/shared/shapes/subsetOrder';

describe('a reorder within what is shown', () => {
  it('swaps the moved cards between their own slots and leaves the rest where they were', () => {
    // a and c are Ana's; b and d are somebody else's, filtered out.
    expect(spliceSubsetOrder(['a', 'b', 'c', 'd'], ['c', 'a'])).toEqual(['c', 'b', 'a', 'd']);
  });

  it('is the plain order when everything is shown', () => {
    expect(spliceSubsetOrder(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
  });

  it('changes nothing when nothing moved', () => {
    expect(spliceSubsetOrder(['a', 'b', 'c', 'd'], ['a', 'c'])).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('a card arriving from another column', () => {
  it('sits right after the visible card it was dropped under', () => {
    expect(spliceSubsetOrder(['a', 'b', 'c', 'd'], ['a', 'x', 'c'])).toEqual(['a', 'x', 'b', 'c', 'd']);
  });

  it('sits right before the visible card it was dropped above, when it lands first', () => {
    expect(spliceSubsetOrder(['a', 'b', 'c', 'd'], ['x', 'c'])).toEqual(['a', 'b', 'x', 'c', 'd']);
  });

  it('goes at the end of a column that showed nothing', () => {
    expect(spliceSubsetOrder(['a', 'b'], ['x'])).toEqual(['a', 'b', 'x']);
  });

  it('keeps several newcomers in the order they were dropped', () => {
    expect(spliceSubsetOrder(['a', 'b'], ['x', 'y', 'b'])).toEqual(['a', 'x', 'y', 'b']);
  });
});
