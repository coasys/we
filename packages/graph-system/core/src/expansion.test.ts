/**
 * Expansion tests.
 *
 * Every failure mode here is silent — a node that vanishes when it should not, an edge that
 * disappears without a bundle standing in for it, a budget that truncates without saying so. None of
 * them throws, and all of them look like "the graph is a bit wrong", which is exactly the class of bug
 * that survives manual testing.
 */
import { describe, expect, it } from 'vitest';

import { ExpansionState, SEED_OPENER } from './expansion';
import { GraphStore } from './store';

function node(id: string) {
  return { id, kind: 'entity' as const, type: 'Thing', label: id };
}

function edge(source: string, target: string) {
  return { id: `${source}->${target}`, source, target, type: 'rel' };
}

describe('ExpansionState', () => {
  it('keeps a node that a second opener is also holding', () => {
    const store = new GraphStore();
    const state = new ExpansionState();

    store.merge({ nodes: [node('a'), node('b')], edges: [] });
    state.attribute(SEED_OPENER, ['a', 'b'], []);

    // Both a and b open c — the ordinary case in a graph, and the one naive subtree pruning breaks.
    store.merge({ nodes: [node('c')], edges: [edge('a', 'c'), edge('b', 'c')] });
    state.markExpanded('a', { added: 1 });
    state.attribute('a', ['c'], ['a->c']);
    state.markExpanded('b', { added: 0 });
    state.attribute('b', ['c'], ['b->c']);

    const collapsed = state.collapse('a', store);

    expect(collapsed.removedNodes).not.toContain('c');
  });

  it('removes a node once nothing is holding it any more', () => {
    const store = new GraphStore();
    const state = new ExpansionState();

    store.merge({ nodes: [node('a')], edges: [] });
    state.attribute(SEED_OPENER, ['a'], []);
    store.merge({ nodes: [node('c')], edges: [edge('a', 'c')] });
    state.markExpanded('a', { added: 1 });
    state.attribute('a', ['c'], ['a->c']);

    expect(state.collapse('a', store).removedNodes).toEqual(['c']);
  });

  it('cascades through a node that was itself expanded', () => {
    const store = new GraphStore();
    const state = new ExpansionState();

    store.merge({ nodes: [node('a')], edges: [] });
    state.attribute(SEED_OPENER, ['a'], []);

    store.merge({ nodes: [node('b')], edges: [edge('a', 'b')] });
    state.markExpanded('a', { added: 1 });
    state.attribute('a', ['b'], ['a->b']);

    store.merge({ nodes: [node('c')], edges: [edge('b', 'c')] });
    state.markExpanded('b', { added: 1 });
    state.attribute('b', ['c'], ['b->c']);

    // Closing a folds the whole drill-down back up, rather than leaving c orphaned on screen.
    const collapsed = state.collapse('a', store);
    expect(collapsed.removedNodes.sort()).toEqual(['b', 'c']);
  });

  it('never removes a seeded node', () => {
    const store = new GraphStore();
    const state = new ExpansionState();

    store.merge({ nodes: [node('a'), node('b')], edges: [] });
    state.attribute(SEED_OPENER, ['a', 'b'], []);
    store.merge({ nodes: [], edges: [edge('a', 'b')] });
    state.markExpanded('a', { added: 0 });
    state.attribute('a', ['b'], ['a->b']);

    expect(state.collapse('a', store).removedNodes).toEqual([]);
  });

  it('bundles edges that crossed the collapse boundary, with a weight', () => {
    const store = new GraphStore();
    const state = new ExpansionState();

    // `outside` survives; two of a's children relate to it, so the collapsed view must say "2".
    store.merge({ nodes: [node('a'), node('outside')], edges: [] });
    state.attribute(SEED_OPENER, ['a', 'outside'], []);

    store.merge({
      nodes: [node('c1'), node('c2')],
      edges: [edge('a', 'c1'), edge('a', 'c2'), edge('c1', 'outside'), edge('c2', 'outside')],
    });
    state.markExpanded('a', { added: 2 });
    state.attribute('a', ['c1', 'c2'], ['a->c1', 'a->c2', 'c1->outside', 'c2->outside']);

    const collapsed = state.collapse('a', store);

    expect(collapsed.removedNodes.sort()).toEqual(['c1', 'c2']);
    expect(collapsed.bundles).toHaveLength(1);
    expect(collapsed.bundles[0]).toMatchObject({ source: 'a', target: 'outside', weight: 2, type: 'bundle' });
  });

  it('does not bundle edges wholly inside the collapsed region', () => {
    const store = new GraphStore();
    const state = new ExpansionState();

    store.merge({ nodes: [node('a')], edges: [] });
    state.attribute(SEED_OPENER, ['a'], []);
    store.merge({ nodes: [node('c1'), node('c2')], edges: [edge('a', 'c1'), edge('a', 'c2'), edge('c1', 'c2')] });
    state.markExpanded('a', { added: 2 });
    state.attribute('a', ['c1', 'c2'], ['a->c1', 'a->c2', 'c1->c2']);

    // c1→c2 has no surviving endpoint to attach to; it is information the collapsed view cannot carry.
    expect(state.collapse('a', store).bundles).toEqual([]);
  });

  it('tracks paging so an exhausted node is not re-expanded', () => {
    const state = new ExpansionState();
    state.markExpanded('a', { added: 10, cursor: 'next', total: 30 });
    expect(state.hasMore('a')).toBe(true);
    expect(state.pageState('a')?.loaded).toBe(10);

    state.markExpanded('a', { added: 20, cursor: undefined, total: 30 });
    expect(state.hasMore('a')).toBe(false);
    expect(state.pageState('a')?.loaded).toBe(30);
  });
});

describe('GraphStore', () => {
  it('merges a repeat sighting without downgrading a resolved node to a placeholder', () => {
    const store = new GraphStore();
    store.merge({ nodes: [{ id: 'a', kind: 'entity', type: 'Post', label: 'Real title' }], edges: [] });
    store.merge({ nodes: [{ id: 'a', kind: 'entity', type: 'Post', unresolved: true }], edges: [] });

    expect(store.node('a')?.unresolved).toBeUndefined();
    expect(store.node('a')?.label).toBe('Real title');
  });

  it('drops an edge whose endpoints are not both present', () => {
    const store = new GraphStore();
    store.merge({ nodes: [node('a')], edges: [edge('a', 'ghost')] });
    expect(store.edgeCount).toBe(0);
  });

  it('walks adjacency in both directions', () => {
    const store = new GraphStore();
    store.merge({ nodes: [node('a'), node('b')], edges: [edge('a', 'b')] });

    expect(store.neighbours('a', 'out')).toEqual(['b']);
    expect(store.neighbours('a', 'in')).toEqual([]);
    // The reverse index is the whole reason a map is explorable rather than a one-way tree.
    expect(store.neighbours('b', 'in')).toEqual(['a']);
    expect(store.degree('b')).toBe(1);
  });

  it('removes the edges of a removed node', () => {
    const store = new GraphStore();
    store.merge({ nodes: [node('a'), node('b')], edges: [edge('a', 'b')] });
    const change = store.removeNodes(['a']);

    expect(change.removedEdges).toEqual(['a->b']);
    expect(store.edgeCount).toBe(0);
    expect(store.neighbours('b', 'in')).toEqual([]);
  });
});
