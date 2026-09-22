/**
 * Fold tests.
 *
 * Every case here is a way a fold can quietly lie about the canvas: a card taken from under somebody
 * who is still pointing at it, a line left running to nothing, a count that says two when four went
 * away, a cycle that either hides nothing or never terminates. None of them throws, and all of them
 * read as "the canvas is a bit wrong" — which is the class of bug that survives being looked at.
 */
import { describe, expect, it } from 'vitest';

import { FOLD_BUNDLE, foldableIn, foldGraph, wouldFold } from './fold';
import { GraphStore } from './store';

function node(id: string) {
  return { id, kind: 'entity' as const, type: 'Thing', label: id };
}

function edge(source: string, target: string) {
  return { id: `${source}->${target}`, source, target, type: 'rel' };
}

/** A store from an edge list, with every named node present. */
function graph(...pairs: [string, string][]): GraphStore {
  const store = new GraphStore();
  const ids = new Set(pairs.flat());
  store.merge({ nodes: [...ids].map(node), edges: [] });
  store.merge({ nodes: [], edges: pairs.map(([from, to]) => edge(from, to)) });
  return store;
}

describe('foldGraph', () => {
  it('hides what hangs off a folded card, and not the card itself', () => {
    const { hidden } = foldGraph(['a'], graph(['a', 'b'], ['a', 'c']));

    expect([...hidden].sort()).toEqual(['b', 'c']);
  });

  it('goes all the way down', () => {
    const { hidden } = foldGraph(['a'], graph(['a', 'b'], ['b', 'c'], ['c', 'd']));

    expect([...hidden].sort()).toEqual(['b', 'c', 'd']);
  });

  it('follows connections outward only — what points AT a card is not under it', () => {
    const { hidden } = foldGraph(['a'], graph(['parent', 'a'], ['a', 'child']));

    expect([...hidden]).toEqual(['child']);
  });

  it('leaves a card a second, unfolded parent is still pointing at', () => {
    // The case naive subtree pruning breaks, and the one that leaves a line running to nothing.
    const { hidden } = foldGraph(['a'], graph(['a', 'shared'], ['other', 'shared']));

    expect(hidden.size).toBe(0);
  });

  it('keeps what hangs off a card it had to leave', () => {
    const { hidden } = foldGraph(['a'], graph(['a', 'shared'], ['other', 'shared'], ['shared', 'below']));

    expect(hidden.size).toBe(0);
  });

  it('folds through a card that something outside merely points at', () => {
    /*
      A fold is a boundary. That `other` points at the folded card says nothing about whether the
      card's contents belong on screen — and walking through it would make folding anything anybody
      had connected to do nothing at all, silently.
    */
    const { hidden } = foldGraph(['a'], graph(['other', 'a'], ['a', 'b']));

    expect([...hidden]).toEqual(['b']);
  });

  it('hides a fold that is itself inside a fold', () => {
    const { hidden } = foldGraph(['a', 'b'], graph(['a', 'b'], ['b', 'c']));

    expect([...hidden].sort()).toEqual(['b', 'c']);
  });

  it('terminates on a cycle, and hides all of it', () => {
    const { hidden } = foldGraph(['a'], graph(['a', 'b'], ['b', 'c'], ['c', 'b']));

    expect([...hidden].sort()).toEqual(['b', 'c']);
  });

  it('survives a cycle back through the folded card', () => {
    const { hidden } = foldGraph(['a'], graph(['a', 'b'], ['b', 'a']));

    expect([...hidden]).toEqual(['b']);
  });

  it('ignores a fold naming a card the canvas no longer holds', () => {
    const { hidden } = foldGraph(['gone', 'a'], graph(['a', 'b']));

    expect([...hidden]).toEqual(['b']);
  });

  it('counts what went away under each fold', () => {
    const { counts } = foldGraph(['a'], graph(['a', 'b'], ['b', 'c'], ['a', 'd']));

    expect(counts.get('a')).toBe(3);
  });

  it('counts nothing for a fold whose contents somebody else already hid', () => {
    // `b` is folded and hidden under `a`; its own count is real but nobody can see it.
    const { counts } = foldGraph(['a', 'b'], graph(['a', 'b'], ['b', 'c']));

    expect(counts.get('a')).toBe(2);
    expect(counts.get('b')).toBe(1);
  });
});

/*
  A fold takes its whole outgoing closure, so a card two steps down goes with the rest and needs
  nothing standing in for it. What makes a boundary is a *survivor*: a card the fold reached and had
  to leave, because somebody outside is still pointing at it. Every case here is built that way —
  `other` holding `kept` is what keeps it on screen — because that is the only shape in which a fold
  can silently drop a connection the reader could see a moment ago.
*/
describe('fold bundles', () => {
  it('stands a line in for a connection that crossed the boundary', () => {
    const { bundles } = foldGraph(['a'], graph(['a', 'b'], ['b', 'kept'], ['other', 'kept']));

    expect(bundles).toHaveLength(1);
    expect(bundles[0]).toMatchObject({ source: 'a', target: 'kept', type: FOLD_BUNDLE, weight: 1 });
  });

  it('carries how many connections it stands for', () => {
    const { bundles } = foldGraph(
      ['a'],
      graph(['a', 'b'], ['a', 'c'], ['b', 'kept'], ['c', 'kept'], ['other', 'kept']),
    );

    expect(bundles).toHaveLength(1);
    expect(bundles[0].weight).toBe(2);
    expect(bundles[0].label).toBe('2');
  });

  it('keeps the direction the hidden connection had', () => {
    /*
      Two folds sharing a card. It is hidden under both — each is a boundary the other cannot be
      seen through — and it is attributed to the first, so the second's connection to it crosses a
      boundary and comes back as a line between the two folds, pointing the way the real one did.
    */
    const { bundles } = foldGraph(['first', 'second'], graph(['first', 'shared'], ['second', 'shared']));

    expect(bundles).toHaveLength(1);
    expect(bundles[0]).toMatchObject({ source: 'second', target: 'first', weight: 1 });
  });

  it('draws nothing for a connection wholly inside the fold', () => {
    const { bundles } = foldGraph(['a'], graph(['a', 'b'], ['a', 'c'], ['b', 'c']));

    expect(bundles).toEqual([]);
  });

  it('draws nothing where the fold is already joined to that card', () => {
    // The reader can see `a` relates to `kept`; a second line fanned out beside it adds nothing.
    const { bundles } = foldGraph(['a'], graph(['a', 'b'], ['b', 'kept'], ['a', 'kept'], ['other', 'kept']));

    expect(bundles).toEqual([]);
  });

  it('stands for no record, so nothing can be opened from it', () => {
    const { bundles } = foldGraph(['a'], graph(['a', 'b'], ['b', 'kept'], ['other', 'kept']));

    expect(bundles[0].reifiedAs).toBeUndefined();
  });
});

describe('wouldFold', () => {
  it('counts what folding a card would take away', () => {
    expect(wouldFold('a', [], graph(['a', 'b'], ['b', 'c']))).toBe(2);
  });

  it('answers zero where a fold would take nothing', () => {
    expect(wouldFold('a', [], graph(['a', 'shared'], ['other', 'shared']))).toBe(0);
  });

  it('counts only what is not already hidden', () => {
    // `b` is gone under `a`'s fold; folding `b` as well takes nothing further.
    expect(wouldFold('b', ['a'], graph(['a', 'b'], ['b', 'c']))).toBe(0);
  });
});

describe('foldableIn', () => {
  it('offers a fold on a card with something under it', () => {
    expect([...foldableIn([], graph(['a', 'b']))]).toEqual(['a']);
  });

  it('offers nothing on a leaf', () => {
    expect(foldableIn([], graph(['a', 'b'])).has('b')).toBe(false);
  });

  it('offers nothing where the fold would take nothing', () => {
    expect(foldableIn([], graph(['a', 'shared'], ['other', 'shared'])).size).toBe(0);
  });

  it('offers it on a folded card, which is what unfolds it', () => {
    expect(foldableIn(['a'], graph(['a', 'b'])).has('a')).toBe(true);
  });

  it('offers nothing on a card that is itself folded away', () => {
    expect(foldableIn(['a'], graph(['a', 'b'], ['b', 'c'])).has('b')).toBe(false);
  });
});
