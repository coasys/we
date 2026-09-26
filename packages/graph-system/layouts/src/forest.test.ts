/**
 * Forest-layout tests.
 *
 * Every case here is a way a ranked tree can quietly mislead: an order that says the opposite of what
 * the data says, two subtrees drawn on top of each other, a parent hanging off the side of its own
 * children, a card that is connected sitting in the "unconnected" zone, or an order that reshuffles on
 * its own while somebody is reading it. None of them throws.
 */
import type { GraphEdge, GraphNode, LayoutInput } from '@we/graph-protocol';
import { describe, expect, it } from 'vitest';

import { forestLayout } from './forest';

const CARD = { width: 100, height: 100 };
const OPTIONS = { card: CARD, siblingGap: 20, levelGap: 50, treeGap: 60 };

function node(id: string, data?: Record<string, string | number | boolean>): GraphNode {
  return { id, kind: 'entity', type: 'Thing', label: id, ...(data ? { data } : {}) };
}

function edge(source: string, target: string, data?: Record<string, string>): GraphEdge {
  return { id: `${source}->${target}`, source, target, type: 'relates', ...(data ? { data } : {}) };
}

function run(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: Record<string, unknown> = {},
  previous?: LayoutInput['previous'],
) {
  return forestLayout({ ...OPTIONS, ...options }).init({
    nodes,
    edges,
    viewport: { width: 1000, height: 800 },
    ...(previous ? { previous } : {}),
  });
}

const yOf = (result: ReturnType<typeof run>, id: string) => result.positions.get(id)?.y;
const xOf = (result: ReturnType<typeof run>, id: string) => result.positions.get(id)?.x;
/** The ids of a set of nodes in the order they are drawn, left to right. */
const leftToRight = (result: ReturnType<typeof run>, ids: string[]) =>
  [...ids].sort((a, b) => (xOf(result, a) ?? 0) - (xOf(result, b) ?? 0));

describe('forest layout — ranks', () => {
  it('puts each generation on its own rank, a card and a gap apart', () => {
    const result = run([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('b', 'c')]);

    expect(yOf(result, 'a')).toBe(0);
    expect(yOf(result, 'b')).toBe(150);
    expect(yOf(result, 'c')).toBe(300);
  });

  it('puts a card reachable at two depths on the shallower rank', () => {
    // a → b → c and a → c. Laying c out at depth 2 would leave the direct edge running backwards up
    // the tree, and which depth won would depend on which edge was read first.
    const result = run([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('b', 'c'), edge('a', 'c')]);

    expect(yOf(result, 'c')).toBe(150);
  });

  it('centres a parent over its own children', () => {
    const result = run([node('p'), node('x'), node('y')], [edge('p', 'x'), edge('p', 'y')]);

    const midpoint = ((xOf(result, 'x') ?? 0) + (xOf(result, 'y') ?? 0)) / 2;
    expect(xOf(result, 'p')).toBeCloseTo(midpoint, 6);
  });

  it('centres a single child under its parent rather than against one edge of it', () => {
    const result = run([node('p'), node('only')], [edge('p', 'only')]);

    expect(xOf(result, 'only')).toBeCloseTo(xOf(result, 'p') ?? 0, 6);
  });

  it('keeps two subtrees clear of each other however deep either goes', () => {
    /*
      p has two children; the left one has three of its own. A layered layout spaces siblings by a
      constant, so the left subtree spreads under the right one's card. A subtree owning a span is what
      stops that, and it is the whole reason this is not `tree` with different numbers.
    */
    const result = run(
      [node('p'), node('l'), node('r'), node('l1'), node('l2'), node('l3')],
      [edge('p', 'l'), edge('p', 'r'), edge('l', 'l1'), edge('l', 'l2'), edge('l', 'l3')],
    );

    const rightmostOfLeftSubtree = Math.max(...['l1', 'l2', 'l3'].map((id) => xOf(result, id) ?? 0));
    expect(rightmostOfLeftSubtree + CARD.width / 2).toBeLessThanOrEqual((xOf(result, 'r') ?? 0) - CARD.width / 2);
  });
});

describe('forest layout — separate trees', () => {
  it('draws each tree beside the next rather than interleaving their ranks', () => {
    const result = run([node('t1'), node('t1a'), node('t2'), node('t2a')], [edge('t1', 't1a'), edge('t2', 't2a')]);

    // Both roots on rank 0, and every card of one tree to one side of every card of the other.
    expect(yOf(result, 't1')).toBe(0);
    expect(yOf(result, 't2')).toBe(0);
    const firstRight = Math.max(xOf(result, 't1') ?? 0, xOf(result, 't1a') ?? 0);
    const secondLeft = Math.min(xOf(result, 't2') ?? 0, xOf(result, 't2a') ?? 0);
    expect(firstRight).toBeLessThan(secondLeft);
  });

  it('orders the trees by their roots, on the same key the siblings use', () => {
    const result = run(
      [node('weak', { weight: 1 }), node('strong', { weight: 9 }), node('wk'), node('sk')],
      [edge('weak', 'wk'), edge('strong', 'sk')],
      { sortBy: 'weight', sortDirection: 'desc' },
    );

    // The strongest card is the top-left one whether it is a sibling or a tree of its own.
    expect(leftToRight(result, ['weak', 'strong'])).toEqual(['strong', 'weak']);
  });

  it('counts a card with no connections at all as unconnected, not as a tree of one', () => {
    /*
      The alternative — a singleton on the root row — is what makes an early board unreadable: most
      cards are unconnected at the start, so the real trees drown among trees of one.
    */
    const result = run([node('p'), node('kid'), node('alone')], [edge('p', 'kid')]);

    expect(result.regions?.[0]?.label).toBe('Unconnected · 1');
    expect(xOf(result, 'alone')).toBeGreaterThan(Math.max(xOf(result, 'p') ?? 0, xOf(result, 'kid') ?? 0));
  });
});

describe('forest layout — sibling order', () => {
  it('orders siblings by the data field, strongest first when asked', () => {
    const result = run(
      [node('p'), node('low', { weight: 1 }), node('high', { weight: 7 }), node('mid', { weight: 4 })],
      [edge('p', 'low'), edge('p', 'high'), edge('p', 'mid')],
      { sortBy: 'weight', sortDirection: 'desc' },
    );

    expect(leftToRight(result, ['low', 'mid', 'high'])).toEqual(['high', 'mid', 'low']);
  });

  it('orders them the other way round on the same data', () => {
    const result = run(
      [node('p'), node('low', { weight: 1 }), node('high', { weight: 7 })],
      [edge('p', 'low'), edge('p', 'high')],
      { sortBy: 'weight', sortDirection: 'asc' },
    );

    expect(leftToRight(result, ['low', 'high'])).toEqual(['low', 'high']);
  });

  it('puts a card with no value last, whichever way the order runs', () => {
    /*
      A card nobody has voted on belongs at the end of a list ordered by votes. Sending it to the front
      when the direction flips would make "least first" mean "the unanswered ones first", which is not a
      reading of the data.
    */
    const ids = ['none', 'low', 'high'];
    const nodes = [node('p'), node('none'), node('low', { weight: 1 }), node('high', { weight: 7 })];
    const edges = ids.map((id) => edge('p', id));

    expect(leftToRight(run(nodes, edges, { sortBy: 'weight', sortDirection: 'desc' }), ids)).toEqual([
      'high',
      'low',
      'none',
    ]);
    expect(leftToRight(run(nodes, edges, { sortBy: 'weight', sortDirection: 'asc' }), ids)).toEqual([
      'low',
      'high',
      'none',
    ]);
  });

  it('breaks a tie the same way every time, however the nodes arrive', () => {
    /*
      The failure this guards is invisible and constant: a subscription hands the graph a freshly built
      array on every unrelated change, so two cards equal on the sort key swap places under the reader's
      cursor. The tiebreak is what makes the arrangement a function of the data alone.
    */
    const nodes = [
      node('p'),
      node('tie-a', { weight: 5, createdAt: '2026-01-02' }),
      node('tie-b', { weight: 5, createdAt: '2026-01-01' }),
    ];
    const edges = [edge('p', 'tie-a'), edge('p', 'tie-b')];
    const forwards = run(nodes, edges, { sortBy: 'weight', sortDirection: 'desc' });
    const backwards = run([...nodes].reverse(), [...edges].reverse(), { sortBy: 'weight', sortDirection: 'desc' });

    // Older first, and the same answer from the reversed input.
    expect(leftToRight(forwards, ['tie-a', 'tie-b'])).toEqual(['tie-b', 'tie-a']);
    expect(leftToRight(backwards, ['tie-a', 'tie-b'])).toEqual(['tie-b', 'tie-a']);
  });
});

describe('forest layout — the spine', () => {
  it('follows only the connections the spine names', () => {
    const result = run(
      [node('a'), node('b'), node('c')],
      [edge('a', 'b', { relationshipTypeId: 'supports' }), edge('a', 'c', { relationshipTypeId: 'mentions' })],
      { spine: { field: 'data.relationshipTypeId', value: 'supports' } },
    );

    // b is a child; c is related by another kind and so is on no tree at all.
    expect(yOf(result, 'b')).toBe(150);
    expect(result.regions?.[0]?.label).toBe('Unconnected · 1');
  });

  it('follows every connection when the spine names no value, as a picker on "any kind" does', () => {
    /*
      The bug this guards made the whole mode look broken: a spine of `value: ''` read literally matches
      only lines whose kind is the empty string, so every card came out in the unconnected zone — with
      the picker showing "Any connection" and the layout following none of them.
    */
    const result = run([node('a'), node('b')], [edge('a', 'b', { relationshipTypeId: 'supports' })], {
      spine: { field: 'data.relationshipTypeId', value: '' },
    });

    expect(yOf(result, 'b')).toBe(150);
    expect(result.regions).toBeUndefined();
    expect(result.warnings).toBeUndefined();
  });

  it('says so when nothing matched the spine, rather than drawing a field of loose cards in silence', () => {
    const result = run([node('a'), node('b')], [edge('a', 'b', { relationshipTypeId: 'mentions' })], {
      spine: { field: 'data.relationshipTypeId', value: 'supports' },
    });

    expect(result.warnings?.[0]).toContain('no connection matched the spine');
  });

  it('ignores a connection to something that is not on the graph', () => {
    // A seed that hides a card keeps the edges it was on, so this is the ordinary case rather than
    // corrupt input — and a parent nobody can see is a tree with an invisible root.
    const result = run([node('a')], [edge('gone', 'a')]);

    expect(yOf(result, 'a')).toBe(0);
    expect(result.regions?.[0]?.label).toBe('Unconnected · 1');
  });
});

describe('forest layout — the unconnected zone', () => {
  it('puts cards on no tree clear to the right of the trees, and names how many', () => {
    const result = run([node('p'), node('kid'), node('loose1'), node('loose2')], [edge('p', 'kid')]);

    const treeRight = Math.max(xOf(result, 'p') ?? 0, xOf(result, 'kid') ?? 0);
    expect(xOf(result, 'loose1')).toBeGreaterThan(treeRight);
    expect(result.regions).toHaveLength(1);
    expect(result.regions?.[0]).toMatchObject({ id: 'forest:unattached', label: 'Unconnected · 2' });
  });

  it('has a zone that actually contains the cards it is drawn around', () => {
    const result = run([node('a'), node('b'), node('c'), node('d')], [], { unattachedColumns: 2 });
    const bounds = result.regions?.[0]?.bounds;

    expect(bounds).toBeDefined();
    for (const id of ['a', 'b', 'c', 'd']) {
      const at = result.positions.get(id)!;
      expect(at.x).toBeGreaterThanOrEqual(bounds!.minX);
      expect(at.x).toBeLessThanOrEqual(bounds!.maxX);
      expect(at.y).toBeGreaterThanOrEqual(bounds!.minY);
      expect(at.y).toBeLessThanOrEqual(bounds!.maxY);
    }
  });

  it('wraps the zone into the column width it is given', () => {
    const result = run([node('a'), node('b'), node('c')], [], { unattachedColumns: 2 });

    // Two across, then wrap: the third sits under the first.
    expect(xOf(result, 'c')).toBeCloseTo(xOf(result, 'a') ?? 0, 6);
    expect(yOf(result, 'c')).toBeGreaterThan(yOf(result, 'a') ?? 0);
  });

  it('puts the zone below the trees when asked, for a narrow screen', () => {
    const result = run([node('p'), node('kid'), node('loose')], [edge('p', 'kid')], { unattached: 'bottom' });

    expect(yOf(result, 'loose')).toBeGreaterThan(yOf(result, 'kid') ?? 0);
  });

  it('draws no zone at all when everything is on a tree', () => {
    const result = run([node('p'), node('kid')], [edge('p', 'kid')]);

    expect(result.regions).toBeUndefined();
  });
});

describe('forest layout — degenerate shapes', () => {
  it('draws a loop as a tree and says that it had to open one', () => {
    // No card in a cycle is above the others, so there is no root. Dropping the whole group into the
    // unconnected zone would be a lie — they are connected, just circularly.
    const result = run([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]);

    expect(result.positions.size).toBe(3);
    expect(result.regions).toBeUndefined();
    expect(result.warnings?.some((w) => w.includes('loop'))).toBe(true);
  });

  it('places a card under one parent only, and does not lose it', () => {
    const result = run([node('p1'), node('p2'), node('shared')], [edge('p1', 'shared'), edge('p2', 'shared')]);

    expect(result.positions.has('shared')).toBe(true);
    // Under the first parent by id, so the same data draws the same way — and the other edge is still
    // in the graph to be drawn, which is what keeps the second relation visible.
    expect(xOf(result, 'shared')).toBeCloseTo(xOf(result, 'p1') ?? 0, 6);
  });

  it('answers an empty graph with nothing rather than a zone', () => {
    const result = run([], []);

    expect(result.positions.size).toBe(0);
    expect(result.regions).toBeUndefined();
    expect(result.warnings).toBeUndefined();
  });

  it('leaves a pinned card where it was put', () => {
    const previous = new Map([['kid', { x: 999, y: 999, fixed: true }]]);
    const result = run([node('p'), node('kid')], [edge('p', 'kid')], {}, previous);

    expect(result.positions.get('kid')).toMatchObject({ x: 999, y: 999 });
  });
});

describe('forest layout — a card being arranged', () => {
  /*
    What a drag in the tree previews. The layout places the held card where the drop would put it, and
    everything around it makes room — the arrangement the drop will produce, before it is written.
  */
  const family = () => ({
    nodes: ['p', 'q', 'a', 'b', 'c', 'x'].map((id, index) => node(id, { rank: index })),
    edges: [edge('p', 'a'), edge('p', 'b'), edge('p', 'c'), edge('q', 'x')],
  });
  const arrange = (arranging: LayoutInput['arranging'], options: Record<string, unknown> = { sortBy: 'rank' }) => {
    const { nodes, edges } = family();
    return forestLayout({ ...OPTIONS, ...options }).init({
      nodes,
      edges,
      viewport: { width: 1000, height: 800 },
      ...(arranging ? { arranging } : {}),
    });
  };

  it('moves a card to another place among its siblings, and the others make room', () => {
    expect(leftToRight(arrange(undefined), ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(leftToRight(arrange({ id: 'c', parent: 'p', index: 0 }), ['a', 'b', 'c'])).toEqual(['c', 'a', 'b']);
    expect(leftToRight(arrange({ id: 'a', parent: 'p', index: 1 }), ['a', 'b', 'c'])).toEqual(['b', 'a', 'c']);
  });

  it('puts a card under another parent, at the place asked for', () => {
    const result = arrange({ id: 'b', parent: 'q', index: 0 });
    // One rank under q, left of x — and gone from p's row, which closes up.
    expect(yOf(result, 'b')).toBe(yOf(result, 'x'));
    expect(leftToRight(result, ['b', 'x'])).toEqual(['b', 'x']);
    expect(Math.abs(xOf(result, 'b')! - xOf(result, 'x')!)).toBe(120);
    expect(leftToRight(result, ['a', 'c'])).toEqual(['a', 'c']);
  });

  it('takes a card out of every tree when it has no parent to be under', () => {
    const result = arrange({ id: 'c', parent: null });
    expect(result.regions?.[0]?.label).toContain('1');
  });

  it('places a card by its own order where no position is asked for — the honest preview for a date order', () => {
    // Ordered by rank, c belongs after a and b whatever the drag says, so that is where it is drawn.
    expect(leftToRight(arrange({ id: 'c', parent: 'p' }), ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('reports the tree as the data has it, not as the drag is previewing it', () => {
    // What a drop would change, so what a gesture has to read — whatever is on screen mid-drag.
    const { hierarchy } = arrange({ id: 'b', parent: 'q', index: 0 });
    expect(hierarchy?.parents.get('b')).toBe('p');
    expect(hierarchy?.children.get('p')).toEqual(['a', 'b', 'c']);
    expect(hierarchy?.children.get('q')).toEqual(['x']);
    expect(hierarchy?.parentEdges.get('b')).toBe('p->b');
  });

  it('ignores a card or a parent that is not on the graph', () => {
    expect(leftToRight(arrange({ id: 'gone', parent: 'p', index: 0 }), ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(leftToRight(arrange({ id: 'a', parent: 'gone', index: 0 }), ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });
});
