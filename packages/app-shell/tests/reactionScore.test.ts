/**
 * A card's reaction score, as the badge reads it off what the canvas seed weighed.
 */
import { describe, expect, it } from 'vitest';

import { readWeighed, roundScore } from '../src/shared/reactionScore';

describe('a card’s reaction score', () => {
  it('reads only the weighing for the reaction asked about', () => {
    const data = { weightType: 'like', weight: 3, weightCount: 3, weightAggregate: 'count' };
    expect(readWeighed(data, 'like')).toEqual({ weight: 3, count: 3, aggregate: 'count' });
    expect(readWeighed(data, 'star')).toBeNull();
  });

  it('prints a count whole and an average to one place', () => {
    expect(roundScore(3.2, 'count')).toBe(3);
    expect(roundScore(3.26, 'mean')).toBe(3.3);
  });
});
