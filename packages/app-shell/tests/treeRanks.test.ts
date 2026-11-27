/**
 * Writing the order a card was dropped into, in a tree read "as arranged".
 *
 * Reported as a drop that held for a few seconds and then slid back. The tree showed the drop, and the store
 * wrote ranks worked out from its own idea of the row — which differed from the tree's wherever cards had
 * never been ranked, since the tree orders those by when they were made and the store could not. So the
 * ranks described some other order, the tree gave up waiting for the one it had shown, and drew what the
 * data said. What is guarded here is that the ranks written describe the row as given, and no other.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { isRank, isUnder, RANK_STEP, rowFor, seatInRow } from '../src/shared/kernels/treeRanks';

/** The writes as a map, which is how the assertions below read them. */
const seat = (row: { id: string; rank?: number }[], card: string, index: number) =>
  new Map(seatInRow(row, card, index).map((write) => [write.id, write.rank]));

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
    const writes = seat(row, 'x', 1);
    expect([...writes]).toEqual([['x', 1536]]);
    expect(orderAfter(row, 'x', writes)).toEqual(['a', 'x', 'b', 'c']);
  });

  it('goes a step beyond either end', () => {
    const row = [
      { id: 'a', rank: 1024 },
      { id: 'b', rank: 2048 },
    ];
    expect([...seat(row, 'x', 2)]).toEqual([['x', 2048 + RANK_STEP]]);
    expect(orderAfter(row, 'x', seat(row, 'x', 0))).toEqual(['x', 'a', 'b']);
  });

  it('ranks a row nobody has arranged in the order it was shown, not in any order of its own', () => {
    // Shown c, a, b — the order the tree put them in, by when they were made. Nothing here could work
    // that out again from the ids, which is the point.
    const row = [{ id: 'c' }, { id: 'a' }, { id: 'b' }];
    const writes = seat(row, 'x', 2);
    expect(orderAfter(row, 'x', writes)).toEqual(['c', 'a', 'x', 'b']);
  });

  it('renumbers where an unranked card sits beside a ranked one, rather than computing a midpoint against it', () => {
    // b has no rank, so it sorts after every ranked card: a midpoint between a and "b" would put x after b.
    const row = [{ id: 'a', rank: 1024 }, { id: 'b' }, { id: 'c', rank: 4096 }];
    const writes = seat(row, 'x', 2);
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
    expect(orderAfter(row, 'x', seat(row, 'x', 1))).toEqual(['a', 'x', 'b', 'c']);
  });

  it('never writes zero, which a placement reads as no rank at all', () => {
    // A step before 1024 is 0 — the first card of a row whose first rank is one step in.
    const row = [
      { id: 'a', rank: RANK_STEP },
      { id: 'b', rank: 2 * RANK_STEP },
    ];
    const writes = seat(row, 'x', 0);
    expect([...writes.values()]).not.toContain(0);
    expect(orderAfter(row, 'x', writes)).toEqual(['x', 'a', 'b']);
  });

  it('renumbers when the gap has closed', () => {
    const row = [
      { id: 'a', rank: 1 },
      { id: 'b', rank: 1 + Number.EPSILON },
    ];
    expect(orderAfter(row, 'x', seat(row, 'x', 1))).toEqual(['a', 'x', 'b']);
  });

  it('ranks a card joining a parent with no other children', () => {
    expect([...seat([], 'x', 0)]).toEqual([['x', RANK_STEP]]);
  });
});

describe('rowFor', () => {
  it('takes the row from the drop, keeping only real siblings, and the rest after in rank order', () => {
    const { row, index } = rowFor({
      card: 'x',
      siblings: ['a', 'b', 'c'],
      ranks: { c: 1024, b: 2048 },
      order: ['b', 'stranger', 'x', 'a'],
      into: 'sibling',
      target: 'b',
    });
    expect(row).toEqual([{ id: 'b', rank: 2048 }, { id: 'a' }, { id: 'c', rank: 1024 }]);
    expect(index).toBe(1);
  });

  it('puts a drop on a parent last, and one beside a sibling on the side it named', () => {
    const input = { card: 'x', siblings: ['a', 'b'], ranks: { a: 1024, b: 2048 } };
    expect(rowFor({ ...input, into: 'child', target: 'p' }).index).toBe(2);
    expect(rowFor({ ...input, into: 'sibling', target: 'a', before: true }).index).toBe(0);
    expect(rowFor({ ...input, into: 'sibling', target: 'a' }).index).toBe(1);
  });

  it('breaks ties between unranked cards by id in code-point order, whatever the locale', () => {
    const { row } = rowFor({ card: 'x', siblings: ['b', 'B', 'a'], ranks: {}, into: 'child' });
    expect(row.map((entry) => entry.id)).toEqual(['B', 'a', 'b']);
  });
});

describe('isUnder', () => {
  it('finds a card above itself, and stops at a loop rather than walking forever', () => {
    expect(isUnder('c', 'a', { c: 'b', b: 'a' })).toBe(true);
    expect(isUnder('a', 'c', { c: 'b', b: 'a' })).toBe(false);
    expect(isUnder('a', 'z', { a: 'b', b: 'a' })).toBe(false);
  });
});

/*
  The recorded vectors a second host implements the kernel against. Replayed here, so a change to the
  kernel that changes an answer fails until the vectors are recorded again — deliberately.
*/
describe('the recorded vectors', () => {
  const vectors = JSON.parse(
    readFileSync(new URL('../src/shared/kernels/vectors/treeRanks.json', import.meta.url), 'utf8'),
  ) as { name: string; fn: 'seatInRow' | 'rowFor' | 'isUnder'; input: never; output: unknown }[];
  const run = {
    seatInRow: (input: { row: { id: string; rank?: number }[]; card: string; index: number }) =>
      seatInRow(input.row, input.card, input.index),
    rowFor: (input: Parameters<typeof rowFor>[0]) => rowFor(input),
    isUnder: (input: { candidate: string; card: string; parentOf: Record<string, string> }) =>
      isUnder(input.candidate, input.card, input.parentOf),
  };
  it.each(vectors.map((vector) => [vector.name, vector] as const))('%s', (_name, vector) => {
    expect(JSON.parse(JSON.stringify(run[vector.fn](vector.input)))).toEqual(vector.output);
  });
});
