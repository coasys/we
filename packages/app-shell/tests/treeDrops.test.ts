/**
 * A tree drop's reading of the data as plain rules: a spine as a tree, the classes a relation joins,
 * and the ranks a canvas's placements hold.
 */
import type { FollowedRelation } from '@we/graph-expanders';
import { describe, expect, it } from 'vitest';

import { endsOf, ranksOf, spineIndex } from '../src/shared/canvas/treeDrops';

describe('spineIndex', () => {
  it('reads each card’s parent and each parent’s children, and skips a connection missing an end', () => {
    const { parentOf, childrenOf, parents } = spineIndex([
      { id: 'pa', source: 'p', target: 'a' },
      { id: 'pb', source: 'p', target: 'b' },
      { id: 'half', source: 'p' },
    ]);
    expect(parentOf.get('a')?.id).toBe('pa');
    expect(childrenOf.get('p')).toEqual(['a', 'b']);
    expect(parents).toEqual({ a: 'p', b: 'p' });
  });
});

describe('endsOf', () => {
  it('puts the child at whichever end holds the link', () => {
    const toMany = { holder: 'Topic', name: 'positions', target: 'Position' } as FollowedRelation;
    expect(endsOf(toMany)).toEqual({ childType: 'Position', parentType: 'Topic' });
  });
});

describe('ranksOf', () => {
  it('keeps only real ranks, and every placed card', () => {
    const { ranks, placed } = ranksOf([{ node: 'a', rank: 1024 }, { node: 'b', rank: 0 }, { node: 'c' }, { rank: 5 }]);
    expect(ranks).toEqual({ a: 1024 });
    expect([...placed]).toEqual(['a', 'b', 'c']);
  });
});
