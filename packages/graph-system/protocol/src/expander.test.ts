/**
 * Which end of a declared link is the tree's parent — the one rule the canvas seed draws by, the
 * drag writes by and a named spine reads by. Two copies of it that disagreed would have a drop
 * write a link the tree then draws the other way round.
 */
import { describe, expect, it } from 'vitest';

import { heldByChild, treeEnds } from './index';

describe('heldByChild', () => {
  it('reads a forward to-one as held by the child: the value is its parent', () => {
    expect(heldByChild({ cardinality: 'one' })).toBe(true);
  });

  it('reads a forward to-many as held by the parent: each value is a child', () => {
    expect(heldByChild({ cardinality: 'many' })).toBe(false);
  });
});

describe('treeEnds', () => {
  it('puts the pointed-at record above the one pointing, for a to-one', () => {
    expect(treeEnds({ cardinality: 'one' }, 'position', 'topic')).toEqual({ parent: 'topic', child: 'position' });
  });

  it('puts the holder of a list above what it lists', () => {
    expect(treeEnds({ cardinality: 'many' }, 'agenda', 'topic')).toEqual({ parent: 'agenda', child: 'topic' });
  });
});
