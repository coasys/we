/**
 * Dragging a card to a new place in a tree, end to end: the real engine, the real forest layout and the
 * real gesture, driven the way the renderer drives them.
 *
 * What it guards is the preview: while a card is held, the tree lays itself out as the drop would leave it,
 * so the reader sees the result before committing to it. And the drop is one movement: the card travels into
 * the place the preview showed and is held there until the write comes back.
 */
import { defaultBehaviours, GraphEngine, PluginRegistry } from '@we/graph-core';
import { forestLayout } from '@we/graph-layouts';
import type { GraphEdge, GraphEvent, GraphNode, Point, SeedSource } from '@we/graph-protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const context = { dataset: undefined as never } as never;
const LAYOUT = { card: { width: 100, height: 100 }, siblingGap: 20, levelGap: 50, treeGap: 60, sortBy: 'rank' };

/** A parent `p` over `a`, `b` and `c`, ranked in that order; and a second parent `q` over `x`. */
function world(extra: { nodes?: GraphNode[]; edges?: GraphEdge[] } = {}) {
  const ranks: Record<string, number> = { p: 0, q: 1, a: 0, b: 1, c: 2, x: 0 };
  const edges: GraphEdge[] = [
    { id: 'p-a', source: 'p', target: 'a', type: 'rel' },
    { id: 'p-b', source: 'p', target: 'b', type: 'rel' },
    { id: 'p-c', source: 'p', target: 'c', type: 'rel' },
    { id: 'q-x', source: 'q', target: 'x', type: 'rel' },
    ...(extra.edges ?? []),
  ];
  const seed: SeedSource = {
    id: 'test',
    async seed() {
      return {
        nodes: [
          ...Object.keys(ranks).map((id) => ({
            id,
            kind: 'entity' as const,
            type: 'Thing',
            label: id,
            data: { rank: ranks[id] },
          })),
          ...(extra.nodes ?? []),
        ],
        edges: edges.map((edge) => ({ ...edge })),
      };
    },
  };
  return { ranks, edges, seed };
}

async function started(seed: SeedSource, options: Record<string, unknown> = {}) {
  const registry = new PluginRegistry({ seeds: [seed], expanders: [], layouts: { forest: forestLayout } });
  const engine = new GraphEngine({
    spec: {
      seeds: { source: 'test' },
      layout: { type: 'forest', options: LAYOUT },
      nodeStyle: [{ style: { shape: 'card', width: 100, height: 100 } }] as never,
    },
    registry,
    context,
  });
  engine.resize(1600, 900);
  await engine.start();
  const events: GraphEvent[] = [];
  const ctx = { ...engine.behaviourContext(), emit: (event: GraphEvent) => events.push(event) };
  const gesture = defaultBehaviours()['arrange-nodes'](options);
  const at = (id: string) => engine.getPositions().get(id)!;
  /** Drive the gesture at a world point, as the renderer would from a pointer event there. */
  const input = (point: Point, buttons = 1) => ({ at: ctx.toScreen(point), buttons }) as never;
  return {
    engine,
    events,
    at,
    press: (id: string) => gesture.onPointerDown?.(input(at(id)), ctx),
    move: (point: Point) => gesture.onPointerMove?.(input(point), ctx),
    drop: (point: Point) => gesture.onPointerUp?.(input(point, 0), ctx),
  };
}

const order = (engine: GraphEngine, ids: string[]) =>
  [...ids].sort((one, two) => engine.getPositions().get(one)!.x - engine.getPositions().get(two)!.x);

describe('arranging a card in a tree', () => {
  it('changes nothing until the pointer passes a neighbour’s midpoint, then makes room', async () => {
    const { engine, at, press, move } = await started(world().seed);
    const [a, b] = [at('a'), at('b')];
    press('c');

    // Over b, but not yet past its middle: nothing has moved, and the ghost sits where c was.
    move({ x: b.x + 20, y: b.y });
    expect(at('b').x).toBe(b.x);
    expect(engine.getArrangePreview()?.at.x).toBeGreaterThan(b.x);

    // Past it: b steps right into c's place, and the ghost takes b's.
    move({ x: b.x - 20, y: b.y });
    expect(at('b').x).toBeGreaterThan(b.x);
    expect(engine.getArrangePreview()?.at.x).toBe(b.x);
    expect(at('a').x).toBe(a.x);
  });

  it('draws the card under the pointer, and its line to the ghost from the parent it would have', async () => {
    const { engine, at, press, move } = await started(world().seed);
    const b = at('b');
    press('c');
    move({ x: b.x - 20, y: b.y + 5 });

    expect(engine.heldCard()).toBe('c');
    expect(at('c')).toMatchObject({ x: b.x - 20, y: b.y + 5 });
    const preview = engine.getArrangePreview()!;
    // From p, arriving at the ghost's own top edge rather than at the card in the hand.
    expect(preview.line?.from.y).toBeGreaterThan(at('p').y);
    expect(preview.line?.to.x).toBeCloseTo(preview.at.x, 5);
    expect(preview.line?.to.y).toBeLessThan(preview.at.y);
    // c's real line to p is not drawn while it is held: the ghost's line stands for it.
    expect(engine.getEdgeGeometry().has('p-c')).toBe(false);
  });

  it('drops into the place the preview showed, as one movement, and holds it until the write lands', async () => {
    const setup = world();
    const { engine, events, at, press, move, drop } = await started(setup.seed);
    const b = at('b');
    press('c');
    move({ x: b.x - 20, y: b.y });
    drop({ x: b.x - 20, y: b.y });

    // Reported as the store understands it: beside b, before it — and the whole row as it was shown, so
    // the ranks written describe that order rather than one the store worked out again.
    expect(events).toEqual([
      expect.objectContaining({
        type: 'nodeArrange',
        into: 'sibling',
        target: expect.objectContaining({ id: 'b' }),
        before: true,
        order: ['a', 'c', 'b'],
      }),
    ]);
    // Already where it is going — not back in its old place waiting for the write.
    expect(order(engine, ['a', 'b', 'c'])).toEqual(['a', 'c', 'b']);
    expect(engine.heldCard()).toBeNull();

    // The write lands: c is ranked between a and b now, and the data says what the hold did.
    setup.ranks.c = 0.5;
    await engine.refresh();
    expect(order(engine, ['a', 'b', 'c'])).toEqual(['a', 'c', 'b']);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(order(engine, ['a', 'b', 'c'])).toEqual(['a', 'c', 'b']);
  });

  it('goes back to what the data says when a dropped card’s write never lands', async () => {
    const { engine, at, press, move, drop } = await started(world().seed);
    const b = at('b');
    press('c');
    move({ x: b.x - 20, y: b.y });
    drop({ x: b.x - 20, y: b.y });
    expect(order(engine, ['a', 'b', 'c'])).toEqual(['a', 'c', 'b']);

    await vi.advanceTimersByTimeAsync(6000);
    expect(order(engine, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('moves a card under another parent along that parent’s row', async () => {
    const { engine, events, at, press, move, drop } = await started(world().seed);
    const x = at('x');
    press('c');
    move({ x: x.x - 30, y: x.y });

    // Laid out as q's first child, with the line from q.
    expect(order(engine, ['c', 'x'])).toEqual(['c', 'x']);
    expect(engine.getArrangePreview()?.line?.from.x).toBeCloseTo(at('q').x, 0);

    drop({ x: x.x - 30, y: x.y });
    expect(events[0]).toMatchObject({ into: 'sibling', target: { id: 'x' }, before: true });
  });

  it('nests under a card the pointer rests on', async () => {
    const { engine, events, at, press, move, drop } = await started(world().seed);
    const b = at('b');
    press('c');
    // On b's near half, where it has not moved: rest there and the drop means "under b".
    move({ x: b.x + 25, y: b.y });
    expect(engine.getArrangePreview()?.line?.from.x).toBeCloseTo(at('p').x, 0);
    await vi.advanceTimersByTimeAsync(600);

    const preview = engine.getArrangePreview()!;
    expect(preview.at.y).toBeGreaterThan(b.y);
    expect(preview.line?.from.x).toBeCloseTo(at('b').x, 0);

    drop({ x: b.x + 25, y: b.y });
    expect(events[0]).toMatchObject({ into: 'child', target: { id: 'b' } });
  });

  it('does not nest under a card the pointer only passes over', async () => {
    const { engine, at, press, move } = await started(world().seed);
    const b = at('b');
    press('c');
    move({ x: b.x + 25, y: b.y });
    await vi.advanceTimersByTimeAsync(200);
    move({ x: b.x - 25, y: b.y });
    await vi.advanceTimersByTimeAsync(600);
    // Still a place in p's row.
    expect(engine.getArrangePreview()?.line?.from.x).toBeCloseTo(at('p').x, 0);
  });

  it('writes nothing for a drop back where the card started, or out in empty space', async () => {
    const { engine, events, at, press, move, drop } = await started(world().seed);
    const c = at('c');
    press('c');
    move({ x: c.x + 5, y: c.y });
    drop({ x: c.x + 5, y: c.y });
    press('c');
    move({ x: c.x, y: c.y + 2000 });
    drop({ x: c.x, y: c.y + 2000 });

    expect(events).toEqual([]);
    expect(engine.heldCard()).toBeNull();
    expect(order(engine, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('offers no place under the dragged card itself or anything beneath it', async () => {
    const { engine, events, at, press, move, drop } = await started(
      world({
        nodes: [{ id: 'd', kind: 'entity', type: 'Thing', label: 'd', data: { rank: 0 } }],
        edges: [{ id: 'c-d', source: 'c', target: 'd', type: 'rel' }],
      }).seed,
    );
    const d = at('d');
    press('c');
    move({ x: d.x, y: d.y });
    await vi.advanceTimersByTimeAsync(600);
    drop({ x: d.x, y: d.y });

    expect(events).toEqual([]);
    expect(engine.heldCard()).toBeNull();
  });

  it('never shows a sibling order a drag cannot keep, where siblings are ordered by something else', async () => {
    const { engine, events, at, press, move, drop } = await started(world().seed, { reorder: false });
    const b = at('b');
    press('c');
    move({ x: b.x - 20, y: b.y });
    expect(order(engine, ['a', 'b'])).toEqual(['a', 'b']);
    expect(at('b').x).toBe(b.x);
    drop({ x: b.x - 20, y: b.y });
    expect(events).toEqual([]);
  });
});
