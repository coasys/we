/**
 * The map's layout, as a pure function (S2-8): `acornMapGraph`'s projection laid out by the graph's
 * own `forest` layout with the options the `acorn.mapView` part hands it — read out of the part, so
 * the test and the map cannot drift. What it must reproduce is Acorn's Classic map
 * (`classicCoordinates.ts`): parents above their children, siblings by `siblingOrder` with the
 * highest leftmost, an outcome on no connection a one-card tree in line with the others, and
 * nothing thrown or dropped for a connection loop.
 */
import { forestLayout } from '@we/graph-layouts';
import { describe, expect, it } from 'vitest';

import { ACORN_FUNCTIONS, ACORN_PARTS } from '../src/index.ts';

interface Fragment {
  literal: true;
  nodes: Array<{ id: string; label: string; data: Record<string, string | number> }>;
  edges: Array<{ id: string; source: string; target: string; type: string }>;
}

const graphOf = (outcomes: unknown[], connections: unknown[]): Fragment => {
  const fn = ACORN_FUNCTIONS.find((f) => f.name === 'acornMapGraph');
  if (!fn) throw new Error('no acornMapGraph');
  return (fn.fn as (o: unknown) => Fragment)({ outcomes, connections });
};

/** The `GraphView` the part places, wherever it sits in the part's tree. */
function graphView(node: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(node)) return node.map(graphView).find(Boolean);
  if (!node || typeof node !== 'object') return undefined;
  const record = node as Record<string, unknown>;
  if (record.type === 'GraphView') return record.props as Record<string, unknown>;
  return Object.values(record).map(graphView).find(Boolean);
}

const PART_LAYOUT = graphView(ACORN_PARTS.mapView.node)?.layout as { type: string; options: Record<string, unknown> };

const layOut = (outcomes: unknown[], connections: unknown[]) => {
  const graph = graphOf(outcomes, connections);
  const result = forestLayout(PART_LAYOUT.options).init({
    nodes: graph.nodes as never,
    edges: graph.edges as never,
    viewport: { width: 1200, height: 800 },
  });
  const at = (id: string) => {
    const p = result.positions.get(id);
    if (!p) throw new Error(`${id} was not placed`);
    return p;
  };
  return { graph, result, at };
};

const outcome = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  content: id.toUpperCase(),
  scopeType: 'Small',
  ...extra,
});
const edge = (parent: string, child: string, siblingOrder = 0) => ({
  id: `${parent}>${child}`,
  parent,
  child,
  siblingOrder,
});

describe('the outcome map — layout', () => {
  it("is the graph's forest, siblings by rank, lone outcomes as trees", () => {
    expect(PART_LAYOUT.type).toBe('forest');
    expect(PART_LAYOUT.options).toMatchObject({ sortBy: 'rank', unattached: 'trees', containment: [] });
  });

  it('puts a parent above its children, centred over them', () => {
    const { at } = layOut(
      [outcome('p', { scopeType: 'Uncertain' }), outcome('a'), outcome('b')],
      [edge('p', 'a', 1), edge('p', 'b', 0)],
    );
    expect(at('p').y).toBeLessThan(at('a').y);
    expect(at('a').y).toBe(at('b').y);
    expect(at('p').x).toBeCloseTo((at('a').x + at('b').x) / 2);
  });

  it('orders siblings as Acorn does: the highest siblingOrder leftmost, ties by statement', () => {
    const outcomes = [outcome('p'), outcome('a'), outcome('b'), outcome('c')];
    const first = layOut(outcomes, [edge('p', 'a', 0), edge('p', 'b', 2), edge('p', 'c', 1)]);
    const xs = (l: typeof first) => ['a', 'b', 'c'].sort((m, n) => l.at(m).x - l.at(n).x);
    expect(xs(first)).toEqual(['b', 'c', 'a']);
    // Reordered on the connections alone — the outcomes are the same records.
    const second = layOut(outcomes, [edge('p', 'a', 5), edge('p', 'b', 2), edge('p', 'c', 1)]);
    expect(xs(second)).toEqual(['a', 'b', 'c']);
    // Equal siblingOrder: by statement, A before B before C.
    const tied = layOut(outcomes, [edge('p', 'c'), edge('p', 'a'), edge('p', 'b')]);
    expect(xs(tied)).toEqual(['a', 'b', 'c']);
  });

  it('keeps grandchildren under their own parent, and subtrees apart', () => {
    const { at } = layOut(
      [outcome('r'), outcome('a'), outcome('b'), outcome('a1'), outcome('a2'), outcome('b1')],
      [edge('r', 'a', 1), edge('r', 'b', 0), edge('a', 'a1', 1), edge('a', 'a2', 0), edge('b', 'b1')],
    );
    expect(at('a1').y).toBeGreaterThan(at('a').y);
    expect(at('a1').x).toBeLessThan(at('a2').x);
    // a's whole subtree is left of b's.
    expect(Math.max(at('a1').x, at('a2').x)).toBeLessThan(at('b1').x);
  });

  it('draws an outcome on no connection as a one-card tree on the top rank, in line with the others', () => {
    const { at, result, graph } = layOut([outcome('p'), outcome('a'), outcome('lone')], [edge('p', 'a')]);
    expect(graph.nodes.map((n) => n.id)).toContain('lone');
    expect(at('lone').y).toBe(at('p').y);
    // After the tree that was there first — roots keep the order the outcomes arrived in.
    expect(at('lone').x).toBeGreaterThan(at('a').x);
    expect(result.regions ?? []).toEqual([]);
  });

  it('a project of only isolated outcomes is a row of them', () => {
    const { at } = layOut([outcome('a'), outcome('b'), outcome('c')], []);
    expect(new Set([at('a').y, at('b').y, at('c').y]).size).toBe(1);
    expect(at('a').x).toBeLessThan(at('b').x);
    expect(at('b').x).toBeLessThan(at('c').x);
  });

  it('a connection loop with no root still draws every card and every line, and says so', () => {
    const { at, result, graph } = layOut(
      [outcome('a'), outcome('b'), outcome('c')],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')],
    );
    for (const id of ['a', 'b', 'c']) expect(at(id)).toBeTruthy();
    expect(new Set(['a', 'b', 'c'].map((id) => at(id).y)).size).toBe(3);
    expect(graph.edges).toHaveLength(3);
    expect(result.warnings?.join(' ')).toMatch(/loop/);
    // Every card ranked once.
    expect(new Set(graph.nodes.map((n) => n.data.rank)).size).toBe(3);
  });

  it('a child under two parents is placed once, and both connections are drawn', () => {
    const { at, graph } = layOut([outcome('p'), outcome('q'), outcome('x')], [edge('p', 'x'), edge('q', 'x')]);
    expect(at('x').y).toBeGreaterThan(at('p').y);
    expect(graph.edges.map((e) => e.id).sort()).toEqual(['p>x', 'q>x']);
  });
});

describe('the outcome map — what a card holds', () => {
  it("each card is its statement with Acorn's computed scope and status", () => {
    const tasks = JSON.stringify([
      { task: 't1', complete: true },
      { task: 't2', complete: false },
    ]);
    const { nodes } = graphOf(
      [
        outcome('p', { content: 'Parent', scopeType: 'Uncertain' }),
        outcome('s', { content: 'Done', achievementStatus: 'Achieved' }),
        outcome('t', { content: 'Half', taskList: tasks }),
        outcome('u', { content: 'Open question', scopeType: 'Uncertain' }),
      ],
      [edge('p', 's', 1), edge('p', 't', 0)],
    );
    const by = (id: string) => nodes.find((n) => n.id === id)!;
    expect(by('p')).toMatchObject({
      type: 'AcornOutcome',
      label: 'Parent',
      data: {
        content: 'Parent',
        scopeType: 'Big',
        achievementStatus: 'Partially achieved',
        status: 'PartiallyAchieved',
      },
    });
    expect(by('s').data).toMatchObject({ scopeType: 'Small', achievementStatus: 'Achieved' });
    expect(by('t').data).toMatchObject({ scopeType: 'Small', achievementStatus: 'Partially achieved' });
    expect(by('u').data).toMatchObject({ scopeType: 'Uncertain', achievementStatus: 'Not achieved' });
  });

  it('draws a line per connection between two drawn outcomes — none to a missing one, none to itself', () => {
    const { edges } = graphOf(
      [outcome('a'), outcome('b')],
      [
        edge('a', 'b'),
        edge('a', 'gone'),
        edge('b', 'b'),
        { id: 'inc', parent: { id: 'b' }, child: { id: 'a' }, siblingOrder: 0 },
        edge('a', 'b'),
      ],
    );
    expect(edges.map((e) => [e.id, e.source, e.target, e.type])).toEqual([
      ['a>b', 'a', 'b', 'AcornConnection'],
      ['inc', 'b', 'a', 'AcornConnection'],
    ]);
  });

  it('answers an empty graph on wrong-typed input', () => {
    expect(graphOf(null as never, 'x' as never)).toEqual({ literal: true, nodes: [], edges: [] });
  });
});
