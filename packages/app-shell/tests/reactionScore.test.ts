/**
 * A card's reaction score moving on the press, before the write comes back.
 *
 * The badge draws from what the canvas seed read — a score, a count, how it was read and what the reader
 * gave — so a press has to be applied to those numbers rather than to rows it does not have.
 */
import { describe, expect, it } from 'vitest';

import { readWeighed, roundScore, withHeld } from '../src/shared/reactionScore';

describe('a card’s reaction score', () => {
  it('reads only the weighing for the reaction asked about', () => {
    const data = { weightType: 'like', weight: 3, weightCount: 3, weightAggregate: 'count' };
    expect(readWeighed(data, 'like')).toEqual({ weight: 3, count: 3, aggregate: 'count' });
    expect(readWeighed(data, 'star')).toBeNull();
  });

  it('counts a like on the press, and takes it back on a withdrawal', () => {
    const none = { weight: 2, count: 2, aggregate: 'count' as const };
    expect(withHeld(none, 1)).toEqual({ score: 3, mine: 1 });
    const mine = { ...none, mine: 1 };
    expect(withHeld(mine, null)).toEqual({ score: 1 });
  });

  it('moves a net vote by the difference between the old answer and the new', () => {
    expect(withHeld({ weight: 4, count: 5, mine: -1, aggregate: 'sum' }, 1)).toEqual({ score: 6, mine: 1 });
  });

  it('re-averages a rating with the reader’s new value in place of the old', () => {
    // 3 raters averaging 3 (total 9), the reader among them with 1: changed to 4, total 12 over 3.
    expect(withHeld({ weight: 3, count: 3, mine: 1, aggregate: 'mean' }, 4)).toEqual({ score: 4, mine: 4 });
    // The only rater withdrawing leaves no rating at all, not a zero.
    expect(withHeld({ weight: 5, count: 1, mine: 5, aggregate: 'mean' }, null)).toEqual({});
  });

  it('draws the stored answer when nothing is held', () => {
    expect(withHeld({ count: 0, aggregate: 'mean' }, undefined)).toEqual({});
    expect(withHeld({ weight: 2.5, count: 2, mine: 3, aggregate: 'mean' }, undefined)).toEqual({ score: 2.5, mine: 3 });
  });

  it('prints a count whole and an average to one place', () => {
    expect(roundScore(3.2, 'count')).toBe(3);
    expect(roundScore(3.26, 'mean')).toBe(3.3);
  });
});
