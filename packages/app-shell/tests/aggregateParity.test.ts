/**
 * The two places a reaction type's aggregate is decided, held to one answer.
 *
 * `aggregateFor` is the rule every reaction surface reads a type through. The canvas seed restates it
 * as `effectiveAggregate`, because the graph packages do not depend on the design system — and a
 * second copy of a rule is the copy that drifts. If it did, a tree ordered by a rating would rank cards
 * by something other than the number the same card shows in the inspector, with nothing on screen to
 * say why. So every pair of aggregate and mode is checked here, where both are in reach.
 */
import { aggregateFor } from '@we/components/signals';
import { effectiveAggregate } from '@we/graph-expanders';
import { describe, expect, it } from 'vitest';

const modes = ['toggle', 'vote', 'rating', 'slider'] as const;
const aggregates = [undefined, 'count', 'sum', 'mean', 'median'] as const;

describe('a reaction type read as one number', () => {
  it('is read the same way by the canvas seed as by every reaction surface', () => {
    for (const mode of modes) {
      for (const aggregate of aggregates) {
        const type = { mode, ...(aggregate ? { aggregate } : {}) } as Parameters<typeof aggregateFor>[0];
        expect(effectiveAggregate(aggregate, mode), `${aggregate ?? 'unset'} on a ${mode}`).toBe(aggregateFor(type));
      }
    }
  });
});
