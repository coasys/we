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
    press: (id: string, grab: Point = { x: 0, y: 0 }) =>
      gesture.onPointerDown?.(input({ x: at(id).x + grab.x, y: at(id).y + grab.y }), ctx),
    /** Where the card would be drawn at a place — what the gesture measures a card against. */
    ghostAt: (id: string, place: { parent: string; index?: number }) => ctx.placesOf(id, [place])[0]!,
    move: (point: Point) => gesture.onPointerMove?.(input(point), ctx),
    drop: (point: Point) => gesture.onPointerUp?.(input(point, 0), ctx),
  };
}

const order = (engine: GraphEngine, ids: string[]) =>
  [...ids].sort((one, two) => engine.getPositions().get(one)!.x - engine.getPositions().get(two)!.x);

describe('arranging a card in a tree', () => {
  it('changes nothing until the card is nearer another place than its own, then makes room under it', async () => {
    const { engine, at, press, move } = await started(world().seed);
    const [a, b, c] = [at('a'), at('b'), at('c')];
    press('c');

    // Nearer its own place than b's: nothing has moved, and the ghost sits where c was.
    move({ x: (b.x + c.x) / 2 + 10, y: b.y });
    expect(at('b').x).toBe(b.x);
    expect(engine.getArrangePreview()?.at.x).toBe(c.x);

    // Nearer b's: b steps right into c's place, and the ghost takes b's — under the card.
    move({ x: (b.x + c.x) / 2 - 10, y: b.y });
    expect(at('b').x).toBeGreaterThan(b.x);
    expect(engine.getArrangePreview()?.at.x).toBe(b.x);
    expect(at('a').x).toBe(a.x);
  });

  it('keeps the gap under the card across a tree that has closed up behind it', async () => {
    // Reported: moving right toward another tree, a gap opened only once the card was already past it, to
    // its left. The card's own slot closes as soon as it heads elsewhere, and everything beyond slides over;
    // a gap measured against the tree as it stood was a slot out.
    const { engine, at, press, move } = await started(world().seed);
    const [c, x] = [at('c'), at('x')];
    press('c');
    for (let px = c.x; px <= x.x + 60; px += 10) {
      move({ x: px, y: c.y });
      await vi.advanceTimersByTimeAsync(400);
      const ghost = engine.getArrangePreview()!.at;
      // Never more than half a slot (card 100 + gap 20) from the card in the hand.
      expect(Math.abs(ghost.x - px)).toBeLessThanOrEqual(61);
    }
  });

  it('decides from the card, not the pointer, when the card is picked up by its edge', async () => {
    const { engine, at, press, move } = await started(world().seed);
    const [b, c] = [at('b'), at('c')];
    const middle = (b.x + c.x) / 2;
    // Held 45 right of its middle: the card's body is left of the pointer.
    press('c', { x: 45, y: 0 });
    // The card's middle is nearer b's place, though the pointer is nowhere near b.
    move({ x: middle + 35, y: b.y });
    expect(engine.getArrangePreview()?.at.x).toBe(b.x);
    // And back past the middle: its own place again.
    move({ x: middle + 55, y: b.y });
    expect(engine.getArrangePreview()?.change).toBe(false);
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

  it('draws a dropped card’s line from its new parent at once, not from the old one until the write lands', async () => {
    const setup = world();
    const { engine, at, press, move, ghostAt, drop } = await started(setup.seed);
    const x = at('x');
    press('c');
    const before = ghostAt('c', { parent: 'q', index: 0 });
    move({ x: before.x + 10, y: x.y });
    drop({ x: before.x + 10, y: x.y });
    await vi.advanceTimersByTimeAsync(1000);

    // The stored connection still says p; the line is drawn from q, where the card was dropped.
    const line = engine.getEdgeGeometry().get('p-c')!;
    const q = at('q');
    expect(Math.abs(line.from.x - q.x)).toBeLessThan(60);
    expect(Math.abs(line.from.y - q.y)).toBeLessThan(60);

    // The write lands: the same connection now says q, and there is still one line, drawn from there.
    setup.edges.find((edge) => edge.id === 'p-c')!.source = 'q';
    await engine.refresh();
    expect(engine.drawnEdges().filter((edge) => edge.target === 'c')).toHaveLength(1);
    expect(Math.abs(engine.getEdgeGeometry().get('p-c')!.from.x - at('q').x)).toBeLessThan(60);
  });

  it('draws a line for a card that had no parent the moment it is dropped under one', async () => {
    const setup = world({ nodes: [{ id: 'z', kind: 'entity', type: 'Thing', label: 'z', data: { rank: 0 } }] });
    const { engine, at, press, move, drop } = await started(setup.seed);
    const b = at('b');
    const below = { x: b.x, y: b.y + (b.y - at('p').y) };
    press('z');
    move(below);
    drop(below);
    await vi.advanceTimersByTimeAsync(1000);

    const made = engine.drawnEdges().filter((edge) => edge.target === 'z');
    expect(made).toHaveLength(1);
    expect(made[0].source).toBe('b');
    // A promise, not a record: nothing to press on yet.
    expect(made[0].type).toBe('pending-edge');

    // The write lands as a real connection, and the made-up line goes: one line, the real one.
    setup.edges.push({ id: 'b-z', source: 'b', target: 'z', type: 'rel' });
    await engine.refresh();
    expect(
      engine
        .drawnEdges()
        .filter((edge) => edge.target === 'z')
        .map((edge) => edge.id),
    ).toEqual(['b-z']);
  });

  it('moves the cards when newer data re-sorts the tree, rather than cutting to the new order', async () => {
    // A vote landing, or a card's reactions read for the first time, reorders a row by itself. That is
    // the engine rearranging the tree, and it should read as the cards moving.
    const setup = world();
    const { engine, at } = await started(setup.seed);
    engine.setSelfTravel(300);
    const [a, c] = [at('a'), at('c')];
    setup.ranks.c = -1;
    await engine.refresh();

    // Still where it was drawn: the move has begun, not landed.
    expect(at('c').x).toBeCloseTo(c.x, 0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(at('c').x).toBeCloseTo(a.x, 0);
  });

  it('brings a tree back into view when its cards grow, without zooming in', async () => {
    // Reported: switching to large cards pushed some off the screen. A re-tune keeps the camera where it
    // is on purpose; a reframe is the host saying this one changed how big everything is.
    const { engine } = await started(world().seed);
    engine.viewport.zoomAt({ x: 0, y: 0 }, 2);
    const zoom = engine.viewport.get().zoom;
    const big = { card: { width: 400, height: 300 }, siblingGap: 40, levelGap: 100, treeGap: 120, sortBy: 'rank' };
    engine.setSpec({
      seeds: { source: 'test' },
      layout: { type: 'forest', options: big },
      nodeStyle: [{ style: { shape: 'card', width: 400, height: 300 } }] as never,
    });
    engine.relayout({ fit: 'contain' });

    const seen = engine.viewport.visibleBounds();
    for (const at of engine.getPositions().values()) {
      expect(at.x).toBeGreaterThan(seen.minX);
      expect(at.x).toBeLessThan(seen.maxX);
      expect(at.y).toBeGreaterThan(seen.minY);
      expect(at.y).toBeLessThan(seen.maxY);
    }
    expect(engine.viewport.get().zoom).toBeLessThanOrEqual(zoom);
  });

  it('keeps the cards where they are while held still, and moves them when let go', async () => {
    // A reader presses a card's reaction mark; the write comes back and re-sorts the row. The card
    // must not slide out from under the pointer that pressed it.
    const setup = world();
    const { engine, at } = await started(setup.seed);
    engine.setSelfTravel(300);
    const [a, c] = [at('a'), at('c')];
    engine.keepStill('pointer', true);
    setup.ranks.c = -1;
    await engine.refresh();
    await vi.advanceTimersByTimeAsync(1000);
    expect(at('c').x).toBe(c.x);

    // Two holds are two: letting one go is not letting the cards go.
    engine.keepStill('popover', true);
    engine.keepStill('pointer', false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(at('c').x).toBe(c.x);

    engine.keepStill('popover', false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(at('c').x).toBeCloseTo(a.x, 0);
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
    const { engine, events, at, press, move, drop, ghostAt } = await started(world().seed);
    const x = at('x');
    press('c');
    // Where the gap before x opens — left of where x is drawn now, since c's own slot closes as it goes.
    const before = ghostAt('c', { parent: 'q', index: 0 });
    expect(before.x).toBeLessThan(x.x - 60);
    move({ x: before.x + 10, y: x.y });

    // Laid out as q's first child, with the line from q.
    expect(order(engine, ['c', 'x'])).toEqual(['c', 'x']);
    expect(engine.getArrangePreview()?.line?.from.x).toBeCloseTo(at('q').x, 0);

    drop({ x: before.x + 10, y: x.y });
    expect(events[0]).toMatchObject({ into: 'sibling', target: { id: 'x' }, before: true });
  });

  it('puts a card under one with no children by pointing at the level beneath it, with no resting', async () => {
    // Reported as feeling random: a card with no children offered no place beneath it at all, so the only
    // way under one was to rest on the card itself — inside its own row, which was busy making room.
    const { engine, events, at, press, move, drop } = await started(world().seed);
    const [b, x] = [at('b'), at('x')];
    const below = { x: b.x, y: b.y + (b.y - at('p').y) };
    press('c');
    move(below);

    const preview = engine.getArrangePreview()!;
    expect(preview.at.y).toBeCloseTo(below.y, 0);
    expect(preview.line?.from.x).toBeCloseTo(at('b').x, 0);
    // Nothing else moved level: x is still on the rank it was on.
    expect(at('x').y).toBe(x.y);

    drop(below);
    expect(events).toEqual([
      expect.objectContaining({
        type: 'nodeArrange',
        into: 'child',
        target: expect.objectContaining({ id: 'b' }),
        order: ['c'],
      }),
    ]);
  });

  it('offers the level beneath the bottom of every tree, and not beneath the dragged card’s own subtree', async () => {
    const { engine, events, at, press, move, drop } = await started(
      world({
        nodes: [{ id: 'd', kind: 'entity', type: 'Thing', label: 'd', data: { rank: 0 } }],
        edges: [{ id: 'c-d', source: 'c', target: 'd', type: 'rel' }],
      }).seed,
    );
    const d = at('d');
    const step = at('x').y - at('q').y;

    // Beneath d, which is under the card being dragged: no place.
    press('c');
    move({ x: d.x, y: d.y + step });
    expect(engine.getArrangePreview()?.line?.from.x).not.toBeCloseTo(d.x, 0);
    drop({ x: d.x, y: d.y + step });
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000);

    // Beneath x, the bottom of q's tree: its first child.
    // One point, taken before the drag: lifting a out narrows p's tree, and q's slides left to close up.
    const beneathX = { x: at('x').x, y: at('x').y + step };
    press('a');
    move(beneathX);
    drop(beneathX);
    expect(events[0]).toMatchObject({ into: 'child', target: { id: 'x' } });
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
    const { events, at, press, move, drop } = await started(
      world({
        nodes: [{ id: 'd', kind: 'entity', type: 'Thing', label: 'd', data: { rank: 0 } }],
        edges: [{ id: 'c-d', source: 'c', target: 'd', type: 'rel' }],
      }).seed,
    );
    const d = at('d');
    press('c');
    move({ x: d.x, y: d.y });
    drop({ x: d.x, y: d.y });

    // Over its own child the level still belongs to the nearest place on it — but never one in c's subtree.
    expect(events.map((event) => (event as { target?: { id: string } }).target?.id)).not.toContain('c');
    expect(events.map((event) => (event as { target?: { id: string } }).target?.id)).not.toContain('d');
  });

  it('draws its own place as no change, and a new one as a change', async () => {
    const { engine, at, press, move } = await started(world().seed);
    const [b, c] = [at('b'), at('c')];
    press('c');
    move({ x: c.x + 5, y: c.y });
    expect(engine.getArrangePreview()?.change).toBe(false);
    move({ x: b.x - 20, y: b.y });
    expect(engine.getArrangePreview()?.change).toBe(true);
    // Well off the tree is "never mind", and says so the same way.
    move({ x: c.x, y: c.y + 2000 });
    expect(engine.getArrangePreview()?.change).toBe(false);
  });

  it('holds the last place while the pointer crosses the gap between two levels', async () => {
    // Crossing between ranks used to send the card home and out again, which reopened the tree it came from.
    const { engine, at, press, move } = await started(world().seed);
    const [p, b] = [at('p'), at('b')];
    const step = b.y - p.y;
    press('c');
    move({ x: b.x, y: b.y + step });
    const under = engine.getArrangePreview()!;
    expect(under.line?.from.x).toBeCloseTo(at('b').x, 0);

    // Between b's level and the one beneath it: no row, and no reason to go anywhere else.
    move({ x: b.x, y: b.y + step / 2 });
    expect(engine.getArrangePreview()?.change).toBe(true);
    expect(engine.getArrangePreview()?.at).toEqual(under.at);
  });

  it('never sends the card home while the pointer moves along a level', async () => {
    // Reported: along the bottom of the tree, the gaps between places sent the card back to its old slot,
    // so the whole tree split open and closed again as the pointer moved.
    const { engine, at, press, move } = await started(world().seed);
    const [p, b, x] = [at('p'), at('b'), at('x')];
    const y = b.y + (b.y - p.y);
    press('a');
    for (let px = at('a').x - 40; px <= x.x + 60; px += 10) {
      move({ x: px, y });
      expect(engine.getArrangePreview()?.change).toBe(true);
    }
  });

  it('refuses to take a card out of its tree when its connection is one the host keeps, and says why', async () => {
    const setup = world({
      nodes: [{ id: 'z', kind: 'entity', type: 'Thing', label: 'z', data: { rank: 0 } }],
    });
    const kept = setup.edges.find((edge) => edge.id === 'p-c')!;
    kept.data = { commentsCount: 2 };
    const { engine, events, at, press, move, drop } = await started(setup.seed, {
      keep: ['commentsCount', 'signalsCount'],
      keepReason: 'Discussed.',
    });
    const z = at('z');
    press('c');
    move(z);
    expect(engine.getArrangePreview()).toMatchObject({ change: false, refused: 'Discussed.' });
    drop(z);
    expect(events).toEqual([]);

    // A bare connection goes, as before.
    await vi.advanceTimersByTimeAsync(2000);
    press('b');
    move(z);
    expect(engine.getArrangePreview()?.change).toBe(true);
    drop(z);
    expect(events[0]).toMatchObject({ into: 'loose' });
  });

  it('reaches both the end of one family and the start of the next, which the layout draws at one spot', async () => {
    // Reported: R over A, B and C; A over a1 and a2, B over b1, C over nothing. Carrying B, "A's third child"
    // could not be reached — it and "C's first child" put B at the same spot, and C always won the tie.
    const edges: GraphEdge[] = [
      ['R', 'A'],
      ['R', 'B'],
      ['R', 'C'],
      ['A', 'a1'],
      ['A', 'a2'],
      ['B', 'b1'],
    ].map(([source, target]) => ({ id: `${source}-${target}`, source, target, type: 'rel' }));
    const ranks: Record<string, number> = { R: 0, A: 0, B: 1, C: 2, a1: 0, a2: 1, b1: 0 };
    const seed: SeedSource = {
      id: 'test',
      async seed() {
        return {
          nodes: Object.keys(ranks).map((id) => ({
            id,
            kind: 'entity' as const,
            type: 'Thing',
            label: id,
            data: { rank: ranks[id] },
          })),
          edges: edges.map((edge) => ({ ...edge })),
        };
      },
    };
    const { engine, events, at, press, move, drop, ghostAt } = await started(seed);
    press('B');
    const spot = ghostAt('B', { parent: 'A', index: 2 });
    expect(ghostAt('B', { parent: 'C', index: 0 })).toEqual(spot);

    // Just left of the shared spot: the end of A's family.
    move({ x: spot.x - 10, y: spot.y });
    expect(engine.getArrangePreview()?.line?.from.x).toBeCloseTo(ghostAt('B', { parent: 'A', index: 2 }).x - 120, 0);
    // Just right of it: the start of C's.
    move({ x: spot.x + 10, y: spot.y });
    drop({ x: spot.x + 10, y: spot.y });
    expect(events[0]).toMatchObject({ into: 'child', target: { id: 'C' } });

    // And sliding along the level from the left passes through every place in order.
    await vi.advanceTimersByTimeAsync(2000);
    press('B');
    // Named by what the preview shows: where the ghost is, and which parent its line comes from.
    const seen: string[] = [];
    for (let px = at('a1').x; px <= spot.x + 40; px += 5) {
      move({ x: px, y: spot.y });
      const preview = engine.getArrangePreview()!;
      const name = `${Math.round(preview.at.x)}<${Math.round(preview.line!.from.x)}`;
      if (seen[seen.length - 1] !== name) seen.push(name);
    }
    // A's three places, then C's first: four stops, the last two at one spot under different parents.
    expect(seen).toHaveLength(4);
    const [, , endOfA, startOfC] = seen.map((name) => name.split('<').map(Number));
    expect(endOfA[0]).toBe(startOfC[0]);
    expect(endOfA[1]).toBeLessThan(startOfC[1]);
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
