/**
 * Layout tests.
 *
 * The properties worth pinning are the ones the protocol asks for and a layout can quietly not do:
 * warm start (an expansion must not move everything that was already placed), pinning (a node the user
 * dropped stays dropped), and — for the board case — that positions come from the data rather than
 * from arithmetic.
 */
import type { GraphEdge, GraphNode, LayoutInput } from '@we/graph-protocol';
import { describe, expect, it } from 'vitest';

import { gridLayout, manualLayout, radialLayout, treeLayout } from './deterministic';
import { forceLayout } from './force';

function node(id: string, data?: Record<string, string | number>): GraphNode {
  return { id, kind: 'entity', type: 'Thing', label: id, ...(data ? { data } : {}) };
}

function edge(source: string, target: string): GraphEdge {
  return { id: `${source}->${target}`, source, target, type: 'rel' };
}

const viewport = { width: 800, height: 600 };

function input(nodes: GraphNode[], edges: GraphEdge[] = [], rest: Partial<LayoutInput> = {}): LayoutInput {
  return { nodes, edges, viewport, ...rest };
}

describe('force layout', () => {
  it('places every node and reports itself as still settling', () => {
    const result = forceLayout().init(input([node('a'), node('b')], [edge('a', 'b')]));

    expect(result.positions.size).toBe(2);
    expect(result.running).toBe(true);
    for (const position of result.positions.values()) {
      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
    }
  });

  it('warm-starts an existing node near where it was', () => {
    // The property that stops the whole map jumping every time an expansion adds a node.
    const previous = new Map([['a', { x: 100, y: 100 }]]);
    const result = forceLayout().init(input([node('a'), node('b')], [edge('a', 'b')], { previous }));

    const a = result.positions.get('a')!;
    expect(Math.hypot(a.x - 100, a.y - 100)).toBeLessThan(60);
  });

  it('drops a new node beside the neighbour that introduced it', () => {
    // Otherwise an expansion erupts from the centre of the canvas rather than out of the node clicked.
    const previous = new Map([['a', { x: 400, y: 400 }]]);
    const result = forceLayout().init(input([node('a'), node('b')], [edge('a', 'b')], { previous }));

    const b = result.positions.get('b')!;
    expect(Math.hypot(b.x - 400, b.y - 400)).toBeLessThan(220);
  });

  it('honours a pin', () => {
    const layout = forceLayout();
    layout.init(input([node('a'), node('b')], [edge('a', 'b')]));
    layout.fix?.('a', { x: 250, y: 250 });

    const ticked = layout.tick?.();
    expect(ticked?.positions.get('a')).toMatchObject({ x: 250, y: 250, fixed: true });
  });

  it('stops reporting as running once it has settled', () => {
    const layout = forceLayout({ iterations: 3 });
    layout.init(input([node('a'), node('b')], [edge('a', 'b')]));
    expect(layout.tick?.()?.running).toBe(false);
  });
});

describe('tree layout', () => {
  it('puts each node on the level its shortest path reaches', () => {
    const result = treeLayout({ levelGap: 100 }).init(
      input([node('root'), node('a'), node('b')], [edge('root', 'a'), edge('a', 'b')]),
    );

    const y = (id: string) => result.positions.get(id)!.y;
    expect(y('root')).toBe(0);
    expect(y('a')).toBe(100);
    expect(y('b')).toBe(200);
  });

  it('uses the shallower level for a node reachable two ways', () => {
    // Breadth-first, so traversal order cannot decide the drawing.
    const result = treeLayout({ levelGap: 100 }).init(
      input(
        [node('root'), node('mid'), node('leaf')],
        [edge('root', 'mid'), edge('mid', 'leaf'), edge('root', 'leaf')],
      ),
    );
    expect(result.positions.get('leaf')!.y).toBe(100);
  });

  it('still places a node unreachable from any root', () => {
    const result = treeLayout().init(input([node('a'), node('orphan')], []));
    expect(result.positions.size).toBe(2);
  });

  it('lays out rightward when asked', () => {
    const result = treeLayout({ direction: 'right', levelGap: 50 }).init(
      input([node('root'), node('a')], [edge('root', 'a')]),
    );
    expect(result.positions.get('a')!.x).toBe(50);
    expect(result.positions.get('root')!.x).toBe(0);
  });
});

describe('radial layout', () => {
  it('puts a lone root at the centre and its children on a ring', () => {
    const result = radialLayout({ ringGap: 100 }).init(
      input([node('root'), node('a'), node('b')], [edge('root', 'a'), edge('root', 'b')]),
    );

    expect(result.positions.get('root')).toMatchObject({ x: 0, y: 0 });
    for (const id of ['a', 'b']) {
      const at = result.positions.get(id)!;
      expect(Math.hypot(at.x, at.y)).toBeCloseTo(100, 5);
    }
  });
});

describe('grid layout', () => {
  it('fills rows at the requested width', () => {
    const result = gridLayout({ columns: 2, gap: 10 }).init(input([node('a'), node('b'), node('c')]));

    expect(result.positions.get('a')).toMatchObject({ x: 0, y: 0 });
    expect(result.positions.get('b')).toMatchObject({ x: 10, y: 0 });
    expect(result.positions.get('c')).toMatchObject({ x: 0, y: 10 });
  });

  it('orders by a node data field when asked', () => {
    const result = gridLayout({ columns: 3, gap: 10, sortBy: 'name' }).init(
      input([node('a', { name: 'zebra' }), node('b', { name: 'apple' })]),
    );
    expect(result.positions.get('b')!.x).toBe(0);
    expect(result.positions.get('a')!.x).toBe(10);
  });
});

describe('manual layout', () => {
  it('reads positions from the node data — the board case', () => {
    const result = manualLayout().init(input([node('a', { x: 42, y: 84 })]));
    expect(result.positions.get('a')).toMatchObject({ x: 42, y: 84, fixed: true });
  });

  it('parks a node that has never been placed rather than stacking it at the origin', () => {
    const result = manualLayout({ gap: 100 }).init(input([node('a'), node('b')]));
    expect(result.positions.get('a')).not.toEqual(result.positions.get('b'));
  });

  it('keeps a dragged position over the stored one until it is written back', () => {
    // A drag is immediate; persisting it is the template's decision, so the layout has to hold the
    // new position in the meantime or the node snaps back on the next re-layout.
    const layout = manualLayout();
    layout.fix?.('a', { x: 5, y: 5 });
    const result = layout.init(input([node('a', { x: 42, y: 84 })]));
    expect(result.positions.get('a')).toMatchObject({ x: 5, y: 5 });
  });

  it('parks an unplaced node where the reader is looking, not at the origin', () => {
    // The origin is the one place guaranteed to be wrong: it is wherever the camera is not, so a
    // card created while panned elsewhere appeared to vanish.
    const visible = { x: 4000, y: 2000, width: 800, height: 600 };
    const result = manualLayout({ gap: 100 }).init(input([node('a')], [], { visible }));
    const at = result.positions.get('a')!;

    expect(at.x).toBeGreaterThanOrEqual(visible.x);
    expect(at.x).toBeLessThan(visible.x + visible.width);
    expect(at.y).toBeGreaterThanOrEqual(visible.y);
    expect(at.y).toBeLessThan(visible.y + visible.height);
  });

  it('groups unplaced nodes in a row, so "not put anywhere yet" reads as a state', () => {
    const visible = { x: 0, y: 0, width: 800, height: 600 };
    const result = manualLayout({ gap: 100 }).init(input([node('a'), node('b'), node('c')], [], { visible }));

    // Same row, evenly spaced — a tray rather than a scatter.
    expect(result.positions.get('a')!.y).toBe(result.positions.get('b')!.y);
    expect(result.positions.get('b')!.x - result.positions.get('a')!.x).toBe(100);
  });

  it('falls back to the origin before a surface has been measured', () => {
    // The one moment there is no better answer: no camera, no size, nothing to be relative to.
    const result = manualLayout({ gap: 100 }).init(input([node('a')]));
    expect(result.positions.get('a')).toMatchObject({ x: 50, y: 50 });
  });

  it('says nothing about a fresh board, where carrying no positions is the normal state', () => {
    // The regression: this warned whenever no node carried x/y, which is every board before anybody
    // has dragged a card. It fired as a matter of course and then stayed on screen after the first
    // drag made it untrue — a permanent warning about a state that had passed.
    const result = manualLayout().init(input([node('a'), node('b')]));

    expect(result.warnings ?? []).toEqual([]);
  });

  it('says nothing when some nodes are placed and others are new', () => {
    const result = manualLayout().init(input([node('a', { x: 10, y: 10 }), node('b')]));

    expect(result.warnings ?? []).toEqual([]);
  });

  it('says nothing on the second run over a board whose cards it parked itself', () => {
    /*
      The regression this actually shipped with. The first run parks a card that carries no
      coordinate; on the second, that parked position arrives as `previous` and counts as reused —
      nothing read from data, nothing newly parked, something reused, which is the exact shape of
      "this layout did nothing". So a board of freshly extracted cards, laid out perfectly well,
      raised a warning telling its reader to choose a different layout.

      One layout instance across both runs, because that is what the engine keeps and what makes the
      memory of its own work available at all.
    */
    const layout = manualLayout();
    const first = layout.init(input([node('a'), node('b')]));

    const result = layout.init(input([node('a'), node('b')], [], { previous: first.positions }));

    expect(result.warnings ?? []).toEqual([]);
  });

  it('warns again once a parked node has been given a position of its own', () => {
    // Forgetting is what keeps the memory from excusing a genuine no-op forever: a node somebody
    // dragged is no longer where it is because this layout put it there.
    const layout = manualLayout();
    layout.init(input([node('a')]));
    layout.init(input([node('a', { x: 10, y: 10 })]));

    const result = layout.init(input([node('a')], [], { previous: new Map([['a', { x: 10, y: 10 }]]) }));

    expect(result.warnings?.length).toBe(1);
  });

  it('warns when it was chosen for a graph that stores nothing, and so did nothing at all', () => {
    // The failure actually worth reporting: switching a knowledge map to `manual` leaves every node
    // exactly where the previous layout left it, which on screen is indistinguishable from a layout
    // that ran and decided nothing needed moving.
    const previous = new Map([
      ['a', { x: 3, y: 4 }],
      ['b', { x: 5, y: 6 }],
    ]);
    const result = manualLayout().init(input([node('a'), node('b')], [], { previous }));

    expect(result.warnings?.join(' ')).toContain('left exactly where it already was');
  });
});

describe('pinning across deterministic layouts', () => {
  it('leaves a user-pinned node where it was put', () => {
    const previous = new Map([['a', { x: 999, y: 999, fixed: true }]]);
    const result = gridLayout({ columns: 1 }).init(input([node('a'), node('b')], [], { previous }));
    expect(result.positions.get('a')).toMatchObject({ x: 999, y: 999 });
  });
});
