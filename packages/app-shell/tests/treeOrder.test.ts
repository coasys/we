/**
 * Writing the order a card was dropped into, in a tree read "as arranged".
 *
 * Reported as a drop that held for a few seconds and then slid back. The tree showed the drop, and the store
 * wrote ranks worked out from its own idea of the row — which differed from the tree's wherever cards had
 * never been ranked, since the tree orders those by when they were made and the store could not. So the
 * ranks described some other order, the tree gave up waiting for the one it had shown, and drew what the
 * data said. What is guarded here is that the ranks written describe the row as given, and no other.
 */
import { describe, expect, it } from 'vitest';

import { isRank, RANK_STEP, seatInRow } from '../src/shared/treeOrder';

/** The row the ranks describe, once written: every card, lowest rank first — as the tree sorts it. */
function orderAfter(row: { id: string; rank?: number }[], card: string, writes: Map<string, number>) {
  const ranks = new Map(row.map((entry) => [entry.id, entry.rank]));
  for (const [id, rank] of writes) ranks.set(id, rank);
  const ids = [...row.map((entry) => entry.id), card];
  expect(ids.every((id) => isRank(ranks.get(id)))).toBe(true);
  return ids.sort((a, b) => ranks.get(a)! - ranks.get(b)!);
}

describe('seatInRow', () => {
  it('writes one rank between two neighbours when the row is cleanly ranked', () => {
    const row = [
      { id: 'a', rank: 1024 },
      { id: 'b', rank: 2048 },
      { id: 'c', rank: 3072 },
    ];
    const writes = seatInRow(row, 'x', 1);
    expect([...writes]).toEqual([['x', 1536]]);
    expect(orderAfter(row, 'x', writes)).toEqual(['a', 'x', 'b', 'c']);
  });

  it('goes a step beyond either end', () => {
    const row = [
      { id: 'a', rank: 1024 },
      { id: 'b', rank: 2048 },
    ];
    expect([...seatInRow(row, 'x', 2)]).toEqual([['x', 2048 + RANK_STEP]]);
    expect(orderAfter(row, 'x', seatInRow(row, 'x', 0))).toEqual(['x', 'a', 'b']);
  });

  it('ranks a row nobody has arranged in the order it was shown, not in any order of its own', () => {
    // Shown c, a, b — the order the tree put them in, by when they were made. Nothing here could work
    // that out again from the ids, which is the point.
    const row = [{ id: 'c' }, { id: 'a' }, { id: 'b' }];
    const writes = seatInRow(row, 'x', 2);
    expect(orderAfter(row, 'x', writes)).toEqual(['c', 'a', 'x', 'b']);
  });

  it('renumbers where an unranked card sits beside a ranked one, rather than computing a midpoint against it', () => {
    // b has no rank, so it sorts after every ranked card: a midpoint between a and "b" would put x after b.
    const row = [{ id: 'a', rank: 1024 }, { id: 'b' }, { id: 'c', rank: 4096 }];
    const writes = seatInRow(row, 'x', 2);
    expect(orderAfter(row, 'x', writes)).toEqual(['a', 'b', 'x', 'c']);
    // And leaves alone a card already holding the rank it needs.
    expect(writes.has('a')).toBe(false);
  });

  it('renumbers ranks that are out of step with the order shown', () => {
    const row = [
      { id: 'a', rank: 2048 },
      { id: 'b', rank: 2048 },
      { id: 'c', rank: 1024 },
    ];
    expect(orderAfter(row, 'x', seatInRow(row, 'x', 1))).toEqual(['a', 'x', 'b', 'c']);
  });

  it('never writes zero, which a placement reads as no rank at all', () => {
    // A step before 1024 is 0 — the first card of a row whose first rank is one step in.
    const row = [
      { id: 'a', rank: RANK_STEP },
      { id: 'b', rank: 2 * RANK_STEP },
    ];
    const writes = seatInRow(row, 'x', 0);
    expect([...writes.values()]).not.toContain(0);
    expect(orderAfter(row, 'x', writes)).toEqual(['x', 'a', 'b']);
  });

  it('renumbers when the gap has closed', () => {
    const row = [
      { id: 'a', rank: 1 },
      { id: 'b', rank: 1 + Number.EPSILON },
    ];
    expect(orderAfter(row, 'x', seatInRow(row, 'x', 1))).toEqual(['a', 'x', 'b']);
  });

  it('ranks a card joining a parent with no other children', () => {
    expect([...seatInRow([], 'x', 0)]).toEqual([['x', RANK_STEP]]);
  });
});
