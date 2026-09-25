/**
 * Layout-travel tests.
 *
 * The mechanism exists so that swapping one arrangement for another reads as one movement rather than
 * as a new picture, and every way it can fail is a way it fails *quietly*: a card that jumps anyway,
 * a card left stranded halfway, a card pickable where it has not arrived yet, a drag fought by a
 * timer nobody can see. So these assert what is *drawn* and what is *pickable* at each stage, rather
 * than that some animation was scheduled.
 *
 * Time is faked throughout. A real timer would make the whole file a race, and the arithmetic under
 * test is `elapsed / duration` — there is nothing a real clock would exercise that a controlled one
 * does not.
 */
import type { ExpanderContext, SeedSource } from '@we/graph-protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphEngine } from './engine';
import { PluginRegistry } from './registry';

const context: ExpanderContext = {
  query: async () => [],
  defaultDataset: () => 'ds',
  models: () => [],
  warn: () => undefined,
};

function seedOf(ids: string[]): SeedSource {
  return {
    id: 'test',
    async seed() {
      return {
        nodes: ids.map((id) => ({ id, kind: 'entity' as const, type: 'Thing', label: id })),
        edges: [],
      };
    },
  };
}

/**
 * Two layouts that disagree about where everything goes, so a swap has something to travel across.
 *
 * `left` stacks along y at x=0; `right` stacks along y at x=1000. Both honour `previous` for nothing,
 * which is the point — every node moves by exactly 1000 on a swap, so a drawn x says precisely how
 * far through the travel a card is.
 */
const layouts = {
  left: () => ({
    id: 'left',
    init(input: { nodes: { id: string }[] }) {
      return { positions: new Map(input.nodes.map((node, i) => [node.id, { x: 0, y: i * 100 }])) };
    },
  }),
  right: () => ({
    id: 'right',
    init(input: { nodes: { id: string }[] }) {
      return { positions: new Map(input.nodes.map((node, i) => [node.id, { x: 1000, y: i * 100 }])) };
    },
  }),
};

async function started(spec: Parameters<typeof GraphEngine.prototype.setSpec>[0]) {
  const registry = new PluginRegistry({ seeds: [seedOf(['a', 'b'])], expanders: [], layouts });
  const engine = new GraphEngine({ spec, registry, context });
  engine.resize(800, 600);
  await engine.start();
  return engine;
}

const xOf = (engine: GraphEngine, id: string) => engine.getPositions().get(id)?.x;

/**
 * What a renderer does on every frame: read every node's visual.
 *
 * Which is what makes one *drawn*, and a shape travel starts from what was drawn — see
 * `GraphEngine.drawnVisual`. A test that never draws has nothing to travel a shape from, exactly as a host
 * that never draws has nothing on screen to move.
 */
const drew = (engine: GraphEngine) => {
  for (const node of engine.store.nodes()) engine.visualOf(node);
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('layout travel', () => {
  it('leaves the cards where they were on the first frame, rather than jumping', async () => {
    const engine = await started({ seeds: { source: 'test' }, layout: { type: 'left' } });

    engine.setSpec({ seeds: { source: 'test' }, layout: { type: 'right' } });
    engine.relayout({ travel: 400 });

    // Drawn at the old arrangement even though the new layout has already answered.
    expect(xOf(engine, 'a')).toBe(0);
    expect(engine.isTravelling()).toBe(true);
  });

  it('walks to the new arrangement and lands exactly on it', async () => {
    const engine = await started({ seeds: { source: 'test' }, layout: { type: 'left' } });

    engine.setSpec({ seeds: { source: 'test' }, layout: { type: 'right' } });
    engine.relayout({ travel: 400 });

    await vi.advanceTimersByTimeAsync(200);
    const midway = xOf(engine, 'a')!;
    // Past the start, short of the end. Eased out, so half the time is well past half the distance —
    // asserting the bounds rather than a value keeps the test about the movement, not the curve.
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(1000);

    await vi.advanceTimersByTimeAsync(400);
    expect(xOf(engine, 'a')).toBe(1000);
    expect(xOf(engine, 'b')).toBe(1000);
    expect(engine.isTravelling()).toBe(false);
  });

  it('is pickable where it is drawn, not where it is going', async () => {
    const engine = await started({ seeds: { source: 'test' }, layout: { type: 'left' } });

    engine.setSpec({ seeds: { source: 'test' }, layout: { type: 'right' } });
    engine.relayout({ travel: 400 });

    /*
      The failure this guards is the one the engine's own conventions call out: an index built from
      the destinations leaves every card hittable at a place it has not reached, so a press during the
      travel grabs a card that is not under the pointer.
    */
    expect(engine.index.hitTest({ x: 0, y: 0 })).toContain('a');
    expect(engine.index.hitTest({ x: 1000, y: 0 })).toEqual([]);

    await vi.advanceTimersByTimeAsync(600);
    expect(engine.index.hitTest({ x: 1000, y: 0 })).toContain('a');
  });

  it('does not travel when it is not asked to', async () => {
    const engine = await started({ seeds: { source: 'test' }, layout: { type: 'left' } });

    engine.setSpec({ seeds: { source: 'test' }, layout: { type: 'right' } });
    engine.relayout();

    expect(xOf(engine, 'a')).toBe(1000);
    expect(engine.isTravelling()).toBe(false);
  });

  it('re-aims a travel in flight instead of snapping or walking to a stale destination', async () => {
    const engine = await started({ seeds: { source: 'test' }, layout: { type: 'left' } });

    engine.setSpec({ seeds: { source: 'test' }, layout: { type: 'right' } });
    engine.relayout({ travel: 400 });
    await vi.advanceTimersByTimeAsync(100);
    const partway = xOf(engine, 'a')!;
    expect(partway).toBeGreaterThan(0);
    expect(partway).toBeLessThan(1000);

    /*
      A subscription landing mid-switch. It carries no travel of its own, so it must neither abandon
      the movement — which is what writing the destination straight in would do — nor leave the card
      walking to the destination the previous layout named.
    */
    engine.setSpec({ seeds: { source: 'test' }, layout: { type: 'left' } });
    engine.relayout();

    expect(xOf(engine, 'a')).toBe(partway);
    expect(engine.isTravelling()).toBe(true);

    await vi.advanceTimersByTimeAsync(600);
    expect(xOf(engine, 'a')).toBe(0);
  });

  it('hands a card over to a drag rather than fighting it for the rest of the travel', async () => {
    const engine = await started({ seeds: { source: 'test' }, layout: { type: 'left' } });

    engine.setSpec({ seeds: { source: 'test' }, layout: { type: 'right' } });
    engine.relayout({ travel: 400 });
    await vi.advanceTimersByTimeAsync(100);

    engine.pin('a', { x: 55, y: 55 });
    await vi.advanceTimersByTimeAsync(600);

    // Where the hand left it. Unpinned 'b' still finished its own walk.
    expect(engine.getPositions().get('a')).toMatchObject({ x: 55, y: 55 });
    expect(xOf(engine, 'b')).toBe(1000);
  });

  it('puts a newly arrived card straight where it belongs', async () => {
    const registry = new PluginRegistry({ seeds: [seedOf(['a'])], expanders: [], layouts });
    const engine = new GraphEngine({
      spec: { seeds: { source: 'test' }, layout: { type: 'right' } },
      registry,
      context,
    });
    engine.resize(800, 600);

    await engine.start();

    /*
      A first load has nowhere to come from. Sliding in from a position it never occupied — the origin,
      usually — is the animation equivalent of the thing the `manual` layout's tray exists to avoid.
    */
    expect(xOf(engine, 'a')).toBe(1000);
    expect(engine.isTravelling()).toBe(false);
  });

  it('treats a zero duration as instant, which is what reduced motion asks for', async () => {
    const engine = await started({ seeds: { source: 'test' }, layout: { type: 'left' } });

    engine.setSpec({ seeds: { source: 'test' }, layout: { type: 'right' } });
    engine.relayout({ travel: 0 });

    expect(xOf(engine, 'a')).toBe(1000);
    expect(engine.isTravelling()).toBe(false);
  });

  it('stops travelling when the graph is disposed', async () => {
    const engine = await started({ seeds: { source: 'test' }, layout: { type: 'left' } });

    engine.setSpec({ seeds: { source: 'test' }, layout: { type: 'right' } });
    engine.relayout({ travel: 400 });
    engine.dispose();

    // A leaked frame timer keeps the whole engine reachable, and goes on notifying listeners of a
    // graph nobody is showing.
    expect(vi.getTimerCount()).toBe(0);
  });
});

/**
 * Switching away from a layout that reads positions from the data.
 *
 * `manual` marks every position `fixed`, because on a canvas a coordinate IS the data and a ticking
 * layout must not move it. Every deriving layout then reads `previous.fixed` as "the user pinned
 * this, leave it alone" — `keepFixed` in the deterministic layouts, `fx`/`fy` in force — so switching
 * from a canvas to a tree kept every card exactly where it was and the switch did nothing at all.
 *
 * Nothing about that is visible from inside either layout: each is behaving exactly as documented. The
 * two meanings of `fixed` only collide at the boundary, which is the engine's.
 */
describe('switching away from a canvas', () => {
  /** `manual` in miniature: reads a coordinate off the node, and marks it fixed as the real one does. */
  const fromData = () => ({
    id: 'manual',
    derivesPositions: false,
    init(input: { nodes: { id: string; data?: Record<string, unknown> }[] }) {
      return {
        positions: new Map(
          input.nodes.map((node) => [
            node.id,
            { x: Number(node.data?.x) || 0, y: Number(node.data?.y) || 0, fixed: true },
          ]),
        ),
      };
    },
  });

  /** A deriving layout that honours a pin, exactly as `forest`, `tree`, `grid` and `force` all do. */
  const derived = () => ({
    id: 'derived',
    init(input: {
      nodes: { id: string }[];
      previous?: ReadonlyMap<string, { x: number; y: number; fixed?: boolean }>;
    }) {
      const positions = new Map(input.nodes.map((node, i) => [node.id, { x: 500 + i * 10, y: 500 }]));
      for (const [id, was] of input.previous ?? []) if (was.fixed && positions.has(id)) positions.set(id, was);
      return { positions };
    },
  });

  const placed: SeedSource = {
    id: 'placed',
    async seed() {
      return {
        nodes: [
          { id: 'a', kind: 'entity' as const, type: 'Thing', data: { x: 11, y: 22 } },
          { id: 'b', kind: 'entity' as const, type: 'Thing', data: { x: 33, y: 44 } },
        ],
        edges: [],
      };
    },
  };

  async function canvas() {
    const registry = new PluginRegistry({
      seeds: [placed],
      expanders: [],
      layouts: { manual: fromData, derived },
    });
    const engine = new GraphEngine({
      spec: { seeds: { source: 'placed' }, layout: { type: 'manual' } },
      registry,
      context,
    });
    engine.resize(800, 600);
    await engine.start();
    return engine;
  }

  it('lets the new layout place the cards, rather than every one of them staying put', async () => {
    const engine = await canvas();
    expect(xOf(engine, 'a')).toBe(11);

    engine.setSpec({ seeds: { source: 'placed' }, layout: { type: 'derived' } });
    engine.relayout();

    // The whole of what the reader sees: the arrangement changes.
    expect(xOf(engine, 'a')).toBe(500);
    expect(xOf(engine, 'b')).toBe(510);
  });

  it('still holds a card the reader actually pinned', async () => {
    /*
      The distinction that makes the fix correct rather than a blunt clearing: `fixed` from a layout
      that does not derive positions is bookkeeping, and `fixed` from a person pressing pin is an
      instruction. Only the engine can tell them apart, which is why it answers here.
    */
    const engine = await canvas();
    engine.pin('a', { x: 77, y: 88 });

    engine.setSpec({ seeds: { source: 'placed' }, layout: { type: 'derived' } });
    engine.relayout();

    expect(engine.getPositions().get('a')).toMatchObject({ x: 77, y: 88 });
    expect(xOf(engine, 'b')).toBe(510);
  });
});

/**
 * The camera travels with the cards.
 *
 * Without this the switch reads as the cards *vanishing and flying in from the edge of the screen*, and
 * both halves are behaving correctly: the fit jumps the camera to frame where the new arrangement will
 * be, while every card is still standing in the old one — which that camera no longer shows. Nothing is
 * broken anywhere, and the result is neither movement.
 */
describe('layout travel — the camera', () => {
  /** Two layouts a long way apart, so a fit between them genuinely has to move. */
  const far = {
    near: () => ({
      id: 'near',
      init(input: { nodes: { id: string }[] }) {
        return { positions: new Map(input.nodes.map((n, i) => [n.id, { x: i * 40, y: 0 }])) };
      },
    }),
    away: () => ({
      id: 'away',
      init(input: { nodes: { id: string }[] }) {
        return { positions: new Map(input.nodes.map((n, i) => [n.id, { x: 9000 + i * 40, y: 6000 }])) };
      },
    }),
  };

  async function started() {
    const registry = new PluginRegistry({ seeds: [seedOf(['a', 'b'])], expanders: [], layouts: far });
    const engine = new GraphEngine({
      spec: { seeds: { source: 'test' }, layout: { type: 'near' } },
      registry,
      context,
    });
    engine.resize(800, 600);
    await engine.start();
    return engine;
  }

  it('moves the camera over the travel rather than jumping it before the cards set off', async () => {
    const engine = await started();

    engine.setSpec({ seeds: { source: 'test' }, layout: { type: 'away' } });
    engine.relayout({ fit: true, travel: 400 });

    /*
      The first frame is the whole bug. The cards are still at the old arrangement, so the camera has to
      be too — a camera already at the destination shows an empty region and the cards arrive into it
      from off screen.
    */
    const first = engine.viewport.get();
    const card = engine.getPositions().get('a')!;
    const onScreen = { x: card.x * first.zoom + first.x, y: card.y * first.zoom + first.y };
    expect(onScreen.x).toBeGreaterThan(-200);
    expect(onScreen.x).toBeLessThan(1000);
    expect(onScreen.y).toBeGreaterThan(-200);
    expect(onScreen.y).toBeLessThan(800);

    await vi.advanceTimersByTimeAsync(600);

    // And it arrives framing the cards it followed.
    const settled = engine.viewport.get();
    const landed = engine.getPositions().get('a')!;
    const after = { x: landed.x * settled.zoom + settled.x, y: landed.y * settled.zoom + settled.y };
    expect(after.x).toBeGreaterThan(-200);
    expect(after.x).toBeLessThan(1000);
    expect(after.y).toBeGreaterThan(-200);
    expect(after.y).toBeLessThan(800);
  });

  it('hands the view over to a pan rather than fighting it for the rest of the travel', async () => {
    const engine = await started();

    engine.setSpec({ seeds: { source: 'test' }, layout: { type: 'away' } });
    engine.relayout({ fit: true, travel: 400 });
    await vi.advanceTimersByTimeAsync(100);

    const behaviour = engine.behaviourContext();
    behaviour.pan(120, 0);
    const grabbed = engine.viewport.get().x;
    await vi.advanceTimersByTimeAsync(600);

    // Where the reader left it. A tween still running would have overwritten this on the next frame.
    expect(engine.viewport.get().x).toBe(grabbed);
  });

  it('lands the camera immediately when there is no travel, exactly as a fit always did', async () => {
    const engine = await started();
    const before = engine.viewport.get();

    engine.setSpec({ seeds: { source: 'test' }, layout: { type: 'away' } });
    engine.relayout({ fit: true });

    expect(engine.viewport.get().x).not.toBe(before.x);
  });
});

/**
 * Releasing a card back to a layout that computes once.
 *
 * `setPinned`'s own comment has always said a released node "should be drawn into place, not left
 * sitting where it was let go" — and for a deterministic layout it was not, because the only thing
 * `resumeLayout` did was ask for more frames and there are none. On a tree that leaves the dropped card
 * in open space with the arrangement broken around it, which is exactly what a drag must not do.
 */
describe('releasing a card', () => {
  const rows = () => ({
    id: 'rows',
    init(input: {
      nodes: { id: string }[];
      previous?: ReadonlyMap<string, { x: number; y: number; fixed?: boolean }>;
    }) {
      const positions = new Map(input.nodes.map((n, i) => [n.id, { x: i * 100, y: 0 }]));
      for (const [id, was] of input.previous ?? []) if (was.fixed && positions.has(id)) positions.set(id, was);
      return { positions };
    },
  });

  async function tree() {
    const registry = new PluginRegistry({ seeds: [seedOf(['a', 'b'])], expanders: [], layouts: { rows } });
    const engine = new GraphEngine({
      spec: { seeds: { source: 'test' }, layout: { type: 'rows' } },
      registry,
      context,
    });
    engine.resize(800, 600);
    await engine.start();
    return engine;
  }

  it('puts a dropped card back where the arrangement wants it', async () => {
    const engine = await tree();
    expect(xOf(engine, 'b')).toBe(100);

    // A drag: held frame by frame, then handed back.
    engine.pin('b', { x: 640, y: 480 });
    expect(xOf(engine, 'b')).toBe(640);
    engine.pin('b', null);

    expect(xOf(engine, 'b')).toBe(100);
  });

  it('holds a card that is still pinned, so a drag is not fought frame by frame', async () => {
    /*
      `pin` is called on every pointer move. Re-deriving there would lay the whole graph out per frame —
      and shuffle the siblings under the card being dragged, which is a feature to build deliberately
      rather than a side effect to discover.
    */
    const engine = await tree();

    engine.pin('b', { x: 640, y: 480 });
    engine.pin('b', { x: 650, y: 480 });

    expect(xOf(engine, 'b')).toBe(650);
  });

  it('leaves a canvas alone, where the coordinate is the data', async () => {
    /*
      Re-running `manual` on release would read the card's stored placement — which has not been written
      yet — and undo the drop a frame before the write lands.
    */
    const fromData = () => ({
      id: 'manual',
      derivesPositions: false,
      init(input: { nodes: { id: string }[]; previous?: ReadonlyMap<string, { x: number; y: number }> }) {
        return { positions: new Map(input.nodes.map((n, i) => [n.id, input.previous?.get(n.id) ?? { x: i, y: 0 }])) };
      },
    });
    const registry = new PluginRegistry({ seeds: [seedOf(['a', 'b'])], expanders: [], layouts: { manual: fromData } });
    const engine = new GraphEngine({
      spec: { seeds: { source: 'test' }, layout: { type: 'manual' } },
      registry,
      context,
    });
    engine.resize(800, 600);
    await engine.start();

    engine.pin('b', { x: 640, y: 480 });
    engine.pin('b', null);

    expect(xOf(engine, 'b')).toBe(640);
  });
});

/**
 * The shape half of the same movement.
 *
 * A mode that rearranges the cards usually restyles them too — a canvas of stretched rectangles,
 * triangles and circles becomes a tree of uniform notes — and the two have to be one movement. The
 * failures are all quiet: a box that snaps while its position eases, a card blended against a styling
 * two modes ago, a hit area that follows the destination while the drawing is still on its way.
 */
describe('shape travel', () => {
  const nodes = () => [{ id: 'a', kind: 'entity' as const, type: 'Thing', label: 'a' }];
  const boxes = (width: number, cardShape: string) => [{ style: { shape: 'card', width, cardShape } }];

  const spec = (layout: string, width: number, cardShape = 'note') => ({
    seeds: { source: 'test' },
    layout: { type: layout },
    nodeStyle: boxes(width, cardShape) as never,
  });

  it('eases the box across, on the same clock as the positions', async () => {
    const engine = await started(spec('left', 100));
    drew(engine);
    expect(engine.visualOf(nodes()[0]).width).toBe(100);

    engine.setSpec(spec('right', 300));
    engine.relayout({ travel: 400 });

    // The first frame is the old box, exactly as it is the old position.
    expect(engine.visualOf(nodes()[0]).width).toBe(100);

    await vi.advanceTimersByTimeAsync(200);
    const midway = engine.visualOf(nodes()[0]).width!;
    expect(midway).toBeGreaterThan(100);
    expect(midway).toBeLessThan(300);

    await vi.advanceTimersByTimeAsync(400);
    expect(engine.visualOf(nodes()[0]).width).toBe(300);
  });

  it('carries the silhouette between two card shapes, and stops carrying it at the end', async () => {
    const engine = await started(spec('left', 200, 'triangle'));
    drew(engine);

    engine.setSpec(spec('right', 200, 'note'));
    engine.relayout({ travel: 400 });
    await vi.advanceTimersByTimeAsync(200);

    const morph = engine.visualOf(nodes()[0]).morph;
    expect(morph?.from).toBe('triangle');
    expect(morph?.outline.length).toBeGreaterThan(2);

    await vi.advanceTimersByTimeAsync(400);
    // Arrived: the destination's own shape draws itself, so there is nothing left to hand over.
    expect(engine.visualOf(nodes()[0]).morph).toBeUndefined();
    expect(engine.visualOf(nodes()[0]).cardShape).toBe('note');
  });

  it('blends nothing when only the arrangement changed', async () => {
    const engine = await started(spec('left', 200, 'triangle'));
    drew(engine);

    engine.setSpec(spec('right', 200, 'triangle'));
    engine.relayout({ travel: 400 });
    await vi.advanceTimersByTimeAsync(200);

    expect(engine.visualOf(nodes()[0]).morph).toBeUndefined();
    expect(engine.visualOf(nodes()[0]).width).toBe(200);
  });

  it('does not hold a restyling nobody travelled away from', async () => {
    const engine = await started(spec('left', 100));
    drew(engine);

    // A restyling on its own — a card resized on a canvas. No travel follows it, and it is drawn at once.
    engine.setSpec(spec('left', 300));
    engine.relayout({});
    expect(engine.visualOf(nodes()[0]).width).toBe(300);
    drew(engine);

    /*
      A later rearrangement must not resurrect the width the card left two actions ago. Nothing remembers
      the rules, so the only way this could happen is a snapshot older than what was last on screen.
    */
    engine.setSpec({ ...spec('right', 300), nodeStyle: spec('left', 300).nodeStyle });
    engine.relayout({ travel: 400 });
    await vi.advanceTimersByTimeAsync(200);
    expect(engine.visualOf(nodes()[0]).width).toBe(300);
  });

  it('is pickable at the box it is drawn at, not the one it is heading for', async () => {
    const engine = await started(spec('left', 100));
    drew(engine);

    engine.setSpec(spec('right', 1000));
    engine.relayout({ travel: 400 });

    // 60px right of the card's centre: inside the 1000-wide destination box, outside the 100-wide one
    // it is still drawn as. The hit area resolves through the same blended visual, so nothing is
    // grabbable at a size it has not reached.
    const at = engine.getPositions().get('a')!;
    expect(engine.index.hitTest({ x: at.x + 60, y: at.y })).toEqual([]);
    expect(engine.index.hitTest({ x: at.x, y: at.y })).toEqual(['a']);
  });
});

/**
 * The lines' half of the same movement.
 *
 * Tree mode pins every child's line to its parent's underside and its own top. On the canvas nothing is
 * pinned, so a line meets whichever side it approaches from — and the switch therefore *repins* both
 * ends of every edge. Left as a side change that is one of four letters, the arrowhead teleports across
 * the card at the first frame, which is the one thing a reader tracking a connection cannot follow.
 *
 * So the subject here is the attach point over time, and two properties of it: that it is continuous at
 * both ends of the travel, and that it is never anywhere a card is — the failure the user asked for
 * specifically, an arrowhead disappearing behind the thing it points at.
 */
describe('anchor travel', () => {
  const edges = (): SeedSource => ({
    id: 'test',
    async seed() {
      return {
        nodes: ['a', 'b'].map((id) => ({ id, kind: 'entity' as const, type: 'Thing', label: id })),
        edges: [{ id: 'a->b', source: 'a', target: 'b', type: 'rel' }],
      };
    },
  });

  /** Two layouts far enough apart that a card's own box never reaches the other one. */
  const apart = {
    across: () => ({
      id: 'across',
      init: (input: { nodes: { id: string }[] }) => ({
        positions: new Map(input.nodes.map((node, i) => [node.id, { x: i * 600, y: 0 }])),
      }),
    }),
    down: () => ({
      id: 'down',
      init: (input: { nodes: { id: string }[] }) => ({
        positions: new Map(input.nodes.map((node, i) => [node.id, { x: 0, y: i * 600 }])),
      }),
    }),
    // The same pair as near neighbours — a card and its parent a rank apart, rather than half a screen.
    near: () => ({
      id: 'near',
      init: (input: { nodes: { id: string }[] }) => ({
        positions: new Map(input.nodes.map((node, i) => [node.id, { x: i * 300, y: 0 }])),
      }),
    }),
    under: () => ({
      id: 'under',
      init: (input: { nodes: { id: string }[] }) => ({
        positions: new Map(input.nodes.map((node, i) => [node.id, { x: 0, y: i * 300 }])),
      }),
    }),
  };

  const CARD = [{ style: { shape: 'card' as const, width: 180 } }];

  async function twoCards(layout: string, edgeStyle?: unknown) {
    const registry = new PluginRegistry({ seeds: [edges()], expanders: [], layouts: apart });
    const engine = new GraphEngine({
      spec: {
        seeds: { source: 'test' },
        layout: { type: layout },
        nodeStyle: CARD as never,
        edgeStyle: edgeStyle as never,
      },
      registry,
      context,
    });
    engine.resize(800, 600);
    await engine.start();
    return engine;
  }

  const endOfEdge = (engine: GraphEngine) => engine.getEdgeGeometry().get('a->b')!.to;
  /** Where the attach point sits relative to the target's own centre. */
  const offset = (engine: GraphEngine) => {
    const at = engine.getPositions().get('b')!;
    const to = endOfEdge(engine);
    return { x: to.x - at.x, y: to.y - at.y };
  };

  it('starts the sweep exactly where the line already was', async () => {
    const engine = await twoCards('across');
    // Running left to right, so the line meets b's west side.
    const was = offset(engine);
    expect(was.x).toBeLessThan(0);

    engine.setSpec({
      seeds: { source: 'test' },
      layout: { type: 'down' },
      nodeStyle: CARD as never,
      edgeStyle: [{ style: { sourceAnchor: 's', targetAnchor: 'n' } }] as never,
    });
    engine.relayout({ travel: 400 });

    // The first frame is the old side, whatever the new rule says — the jump this exists to remove.
    expect(offset(engine).x).toBeCloseTo(was.x);
    expect(offset(engine).y).toBeCloseTo(was.y);
  });

  it('swings round the card rather than cutting across it, and lands on the pinned side', async () => {
    const engine = await twoCards('across');
    const seen: { x: number; y: number }[] = [];

    engine.setSpec({
      seeds: { source: 'test' },
      layout: { type: 'down' },
      nodeStyle: CARD as never,
      edgeStyle: [{ style: { sourceAnchor: 's', targetAnchor: 'n' } }] as never,
    });
    engine.relayout({ travel: 400 });

    for (let step = 0; step < 12; step += 1) {
      await vi.advanceTimersByTimeAsync(40);
      seen.push(offset(engine));
    }

    /*
      Never inside the card. A 180-wide card is 135 tall, so its own half-extents are 90 and 67.5 and the
      standoff puts every honest attach point at one of them or beyond. A point closer than both means
      the sweep has taken the line *through* the card, which is the arrowhead vanishing behind it.
    */
    for (const point of seen) {
      const outside = Math.abs(point.x) >= 89 || Math.abs(point.y) >= 67;
      expect(outside).toBe(true);
    }

    /*
      And it genuinely passes *between* the two sides on the way. Without the sweep every frame is the
      pinned side — dead centre of the top — which satisfies the outside test above just as well, so this
      is the assertion that says the movement happened at all.
    */
    const between = seen.some((point) => Math.abs(point.x) > 5 && Math.abs(point.y) > 5);
    expect(between).toBe(true);

    // And it arrives on the top, which is what the rule asked for.
    const landed = seen[seen.length - 1];
    expect(landed.x).toBeCloseTo(0);
    expect(landed.y).toBeLessThan(0);
  });

  it('keeps the whole curve continuous, not only its endpoint', async () => {
    /*
      The control point, which is where a curve's *shape* lives. A sweep that moved the attachment smoothly
      while the tangent jumped would satisfy every other test here and still read as the line snapping, so
      this watches the thing the reader actually sees.

      The reach's own discontinuity — the boolean that says which axis the span is measured on, which flips
      as a card crosses the diagonal — is too small to separate from the travel's own motion at this scale,
      and is pinned directly in `geometry.test.ts` instead. What this catches is the facing.
    */
    /*
      Close together, which is where the jump is worth seeing. The spans between the two ATTACH points are
      each shorter than the span between the centres by the cards' own reach on that axis — by 192 across
      and 146 down for this card — so the two disagree most, in proportion, when the cards are near
      neighbours. Which is the ordinary case in a tree.
    */
    const engine = await twoCards('near');
    engine.setSpec({ seeds: { source: 'test' }, layout: { type: 'under' }, nodeStyle: CARD as never });
    engine.relayout({ travel: 400 });

    const controls: { x: number; y: number }[] = [];
    for (let step = 0; step < 14; step += 1) {
      const geometry = engine.getEdgeGeometry().get('a->b')!;
      const at = engine.getPositions().get('b')!;
      // Relative to the card, so the card's own travel is not counted as a change of shape.
      controls.push({ x: geometry.control2!.x - at.x, y: geometry.control2!.y - at.y });
      await vi.advanceTimersByTimeAsync(40);
    }

    /*
      A SPIKE, judged against its NEIGHBOURS.

      Neither a fixed threshold nor a ratio to the average would do. The travel eases out, so the first
      frame legitimately moves this control a quarter of the way and the last barely at all — a single
      number judges the curve rather than the discontinuity, and the average is dominated by the fast
      start. A flip is a frame out of line with the frames either side of it, which is scale-free and
      survives the easing.
    */
    const steps = controls.slice(1).map((point, i) => Math.hypot(point.x - controls[i].x, point.y - controls[i].y));
    const spike = steps.reduce((most, step, i) => {
      const neighbours = Math.max(steps[i - 1] ?? 0, steps[i + 1] ?? 0);
      return neighbours > 0 ? Math.max(most, step / neighbours) : most;
    }, 0);
    expect(spike).toBeLessThan(2.5);
  });

  it('is continuous into the ordinary derivation at the end', async () => {
    const engine = await twoCards('across');
    engine.setSpec({
      seeds: { source: 'test' },
      layout: { type: 'down' },
      nodeStyle: CARD as never,
      edgeStyle: [{ style: { sourceAnchor: 's', targetAnchor: 'n' } }] as never,
    });
    engine.relayout({ travel: 400 });
    await vi.advanceTimersByTimeAsync(600);

    const swept = offset(engine);
    // The same graph, arranged and styled the same way, with no travel behind it at all.
    const settled = await twoCards('down', [{ style: { sourceAnchor: 's', targetAnchor: 'n' } }]);

    expect(swept.x).toBeCloseTo(offset(settled).x);
    expect(swept.y).toBeCloseTo(offset(settled).y);
  });

  it('sweeps a side nobody pinned, because that is the one that jumps', async () => {
    /*
      No anchors anywhere — the derived side alone, which follows a boolean: is this span mostly
      horizontal. A card travelling from beside its parent to below it crosses the diagonal, and the
      boolean flips in one frame, so the attachment leapt from the card's side to its top. On a shape with
      a far corner — a diamond, where the two are a long way apart — that reads as the arrowhead jumping
      off the card and back on.

      So this asserts the *continuity*, frame by frame, rather than any one position: nothing in the sweep
      may turn faster than the sweep itself.
      */
    const engine = await twoCards('across');
    engine.setSpec({ seeds: { source: 'test' }, layout: { type: 'down' }, nodeStyle: CARD as never });
    engine.relayout({ travel: 400 });

    const angles: number[] = [];
    for (let step = 0; step < 14; step += 1) {
      const at = offset(engine);
      angles.push(Math.atan2(at.y, at.x));
      await vi.advanceTimersByTimeAsync(40);
    }

    const worst = angles.slice(1).reduce((most, angle, i) => {
      const step = Math.abs(Math.atan2(Math.sin(angle - angles[i]), Math.cos(angle - angles[i])));
      return Math.max(most, step);
    }, 0);
    // A quarter turn is the whole of this sweep, so a single frame taking more than a third of it is the
    // boolean flipping rather than the facing turning.
    expect(worst).toBeLessThan(Math.PI / 6);
  });
});

/**
 * What a renderer does around a switch, in every order it might do it in.
 *
 * A mode that rearranges and restyles at once calls `setSpec` several times in one flush — the seeds
 * effect, the layout effect, the style effect — relayouts from one of them and refreshes the hit areas from
 * another, and a subscription can land in the middle of all of it. This used to matter: the shape travel
 * blended from a styling that `setSpec` set aside and a travel had to claim, so whichever call happened to
 * be first or last decided whether the morph happened at all. It broke twice, most visibly as a morph that
 * worked for a few switches and then stopped until the graph was remounted.
 *
 * Nothing depends on the order now — a travel blends from what was last DRAWN — and these are here to keep
 * it that way rather than to describe a sequence anybody has to follow.
 */
describe('a rearrangement and a restyling, in any order', () => {
  const nodes = () => [{ id: 'a', kind: 'entity' as const, type: 'Thing', label: 'a' }];
  const spec = (layout: string, width: number) => ({
    seeds: { source: 'test' },
    layout: { type: layout },
    nodeStyle: [{ style: { shape: 'card', width } }] as never,
  });

  /** Mid-blend: past the start, short of the end. */
  const between = (engine: GraphEngine) => {
    const width = engine.visualOf(nodes()[0]).width!;
    return width > 100 && width < 300;
  };

  it('blends when the travel is asked for before the restyling is acknowledged', async () => {
    const engine = await started(spec('left', 100));
    drew(engine);

    engine.setSpec(spec('right', 300));
    engine.relayout({ travel: 400 });
    // The restyling half, as the adapter's second effect does it.
    engine.setSpec(spec('right', 300));
    engine.refreshHitAreas();

    await vi.advanceTimersByTimeAsync(200);
    expect(between(engine)).toBe(true);
  });

  it('blends when the restyling is acknowledged first', async () => {
    /*
      The order that used to lose the morph outright: refreshing the hit areas was also how a styling nothing
      had travelled away from was let go of, so doing it before the travel threw away the very thing the
      travel was about to blend from.
    */
    const engine = await started(spec('left', 100));
    drew(engine);

    engine.setSpec(spec('right', 300));
    engine.refreshHitAreas();
    engine.relayout({ travel: 400 });

    await vi.advanceTimersByTimeAsync(200);
    expect(between(engine)).toBe(true);
  });

  it('blends with a relayout landing in between, which is what stopped it every few switches', async () => {
    /*
      The reported symptom. A subscription landing, an optimistic write, an expansion and a reconcile all
      relayout without travel, and one arriving in the gap used to consume the thing the travelling relayout
      needed — after which the rules were already installed, so nothing re-armed and every switch from then
      on jumped.
    */
    const engine = await started(spec('left', 100));
    drew(engine);
    const wide = spec('right', 300).nodeStyle;

    engine.setSpec({ ...spec('left', 300), nodeStyle: wide });
    engine.relayout({});
    engine.setSpec({ ...spec('right', 300), nodeStyle: wide });
    engine.relayout({ travel: 400 });

    await vi.advanceTimersByTimeAsync(200);
    expect(between(engine)).toBe(true);
  });

  it('goes on blending switch after switch', async () => {
    /*
      And the shape of the report: it worked for a few and then stopped. Nothing in the mechanism accumulates
      now, but a test that switches once cannot tell.
    */
    const engine = await started(spec('left', 100));
    drew(engine);

    for (let round = 0; round < 6; round += 1) {
      const wide = round % 2 === 0;
      engine.setSpec(spec(wide ? 'right' : 'left', wide ? 300 : 100));
      engine.relayout({ travel: 400 });
      await vi.advanceTimersByTimeAsync(200);
      drew(engine);
      expect(between(engine)).toBe(true);
      await vi.advanceTimersByTimeAsync(400);
      drew(engine);
      expect(engine.visualOf(nodes()[0]).width).toBe(wide ? 300 : 100);
    }
  });
});

/**
 * One canvas's tidying of one connection, and the arrangement that should not read it.
 *
 * A stored anchor beats a style rule, which is right on a canvas: somebody pulled that line to that side of
 * that card, and no rule about a whole arrangement is a better answer than a decision about the thing
 * itself. In a tree it is the wrong way round — every child hangs off its parent's underside and is met at
 * its own top, and that uniformity is the whole of what makes a rank readable.
 */
describe('ignoring a stored route', () => {
  const bent = (): SeedSource => ({
    id: 'test',
    async seed() {
      return {
        nodes: ['a', 'b'].map((id) => ({ id, kind: 'entity' as const, type: 'Thing', label: id })),
        edges: [
          {
            id: 'a->b',
            source: 'a',
            target: 'b',
            type: 'rel',
            // What a canvas stores when somebody tidies a line: a side for one end, and a bend.
            data: { targetAnchor: 'e', waypoints: JSON.stringify([{ along: 0.5, across: 0.4 }]) },
          },
        ],
      };
    },
  });

  const grid = {
    down: () => ({
      id: 'down',
      init: (input: { nodes: { id: string }[] }) => ({
        positions: new Map(input.nodes.map((node, i) => [node.id, { x: 0, y: i * 600 }])),
      }),
    }),
    // The same pair, further apart, so a switch between the two has something to travel across.
    far: () => ({
      id: 'far',
      init: (input: { nodes: { id: string }[] }) => ({
        positions: new Map(input.nodes.map((node, i) => [node.id, { x: 0, y: i * 1200 }])),
      }),
    }),
  };

  async function engineWith(ignoreRoute: boolean, layout = 'down') {
    const registry = new PluginRegistry({ seeds: [bent()], expanders: [], layouts: grid });
    const engine = new GraphEngine({
      spec: {
        seeds: { source: 'test' },
        layout: { type: layout },
        nodeStyle: [{ style: { shape: 'card', width: 180 } }] as never,
        edgeStyle: [{ style: { sourceAnchor: 's', targetAnchor: 'n', ignoreRoute } }] as never,
      },
      registry,
      context,
    });
    engine.resize(800, 600);
    await engine.start();
    return engine;
  }

  it('honours the stored anchor and the bend by default', async () => {
    const engine = await engineWith(false);
    const geometry = engine.getEdgeGeometry().get('a->b')!;
    const at = engine.getPositions().get('b')!;

    // The stored 'e' wins over the rule's 'n': the line arrives at the card's right-hand side.
    expect(geometry.to.x - at.x).toBeGreaterThan(80);
    expect(Math.abs(geometry.to.y - at.y)).toBeLessThan(1);
    // And the bend is drawn, which a waypointed route says by routing through segments.
    expect(geometry.segments).toBeDefined();
  });

  it('draws the rule instead when the rules say to', async () => {
    const engine = await engineWith(true);
    const geometry = engine.getEdgeGeometry().get('a->b')!;
    const at = engine.getPositions().get('b')!;

    // The rule's 'n': met at the top, dead centre, like every other child of every other parent.
    expect(Math.abs(geometry.to.x - at.x)).toBeLessThan(1);
    expect(geometry.to.y - at.y).toBeLessThan(-60);
    // And no bend: one curve shape for the whole rank.
    expect(geometry.segments).toBeUndefined();
    expect(geometry.curve).toBe('smooth');
  });

  it('sweeps from the side the line was actually drawn on', async () => {
    /*
      The half that is easy to get wrong. The sweep's starting direction comes from the styling the lines are
      LEAVING, so it has to honour that styling's answer about stored routes too — which is why one function
      resolves it for both the router and the plan. Read from the rule instead, the first frame would be the
      top and the line would jump there before easing anywhere.
    */
    const engine = await engineWith(false);
    const side = (e: GraphEngine) => e.getEdgeGeometry().get('a->b')!.to.x - e.getPositions().get('b')!.x;
    expect(side(engine)).toBeGreaterThan(80);

    engine.setSpec({
      seeds: { source: 'test' },
      layout: { type: 'far' },
      nodeStyle: [{ style: { shape: 'card', width: 180 } }] as never,
      edgeStyle: [{ style: { sourceAnchor: 's', targetAnchor: 'n', ignoreRoute: true } }] as never,
    });
    engine.relayout({ travel: 400 });

    // The first frame is still the card's right-hand side, where the line has been all along.
    expect(side(engine)).toBeGreaterThan(80);

    // And it arrives at the top, having been somewhere in between on the way.
    const seen: number[] = [];
    for (let step = 0; step < 14; step += 1) {
      await vi.advanceTimersByTimeAsync(40);
      seen.push(side(engine));
    }
    expect(seen[seen.length - 1]).toBeCloseTo(0);
    expect(seen.some((x) => x > 5 && x < 80)).toBe(true);
  });
});

/**
 * Switching again before the first switch has finished.
 *
 * A reader will, and the answer has to be that the cards turn round from wherever they are — not that
 * everything jumps. It did jump: the re-aim carries the clock, which is right for a subscription landing
 * mid-switch (keep the deadline the reader's action set, rather than restarting it on every frame a query
 * happens to arrive on) and wrong for a second action. Carried, the new travel's first frame was computed
 * against a start time a second and a half in the past, so every card was drawn most of the way to its new
 * place before easing the last of it.
 */
describe('switching again mid-switch', () => {
  const nodes = () => [{ id: 'a', kind: 'entity' as const, type: 'Thing', label: 'a' }];
  const spec = (layout: string, width: number) => ({
    seeds: { source: 'test' },
    layout: { type: layout },
    nodeStyle: [{ style: { shape: 'card', width } }] as never,
  });

  it('turns the cards round from where they are, rather than jumping them', async () => {
    const engine = await started(spec('left', 100));
    drew(engine);

    engine.setSpec(spec('right', 300));
    engine.relayout({ travel: 400 });
    await vi.advanceTimersByTimeAsync(200);
    const caught = xOf(engine, 'a')!;
    // Eased out, so half the time is well past half the distance — which is what makes the carried clock
    // so visible when it happens.
    expect(caught).toBeGreaterThan(500);
    expect(caught).toBeLessThan(1000);

    // And now the reader changes their mind.
    engine.setSpec(spec('left', 100));
    engine.relayout({ travel: 400 });

    // The first frame is exactly where the card was.
    expect(xOf(engine, 'a')).toBeCloseTo(caught);

    await vi.advanceTimersByTimeAsync(40);
    const oneFrame = xOf(engine, 'a')!;
    // Moving back the way it came, and by one frame's worth. Carrying the clock put it near zero here.
    expect(oneFrame).toBeLessThan(caught);
    expect(oneFrame).toBeGreaterThan(caught * 0.6);

    await vi.advanceTimersByTimeAsync(600);
    expect(xOf(engine, 'a')).toBe(0);
  });

  it('carries the half-morphed shape on rather than starting it again', async () => {
    /*
      The same question about the shape. It comes out of the drawn snapshot for free — what was on screen
      half-way through a morph is a half-morphed card — where anything that remembered the styling being
      left would have sent it back to the shape it started from before easing it forward again.
    */
    const engine = await started(spec('left', 100));
    drew(engine);

    engine.setSpec(spec('right', 300));
    engine.relayout({ travel: 400 });
    await vi.advanceTimersByTimeAsync(200);
    drew(engine);
    const caught = engine.visualOf(nodes()[0]).width!;
    expect(caught).toBeGreaterThan(100);
    expect(caught).toBeLessThan(300);

    engine.setSpec(spec('left', 100));
    engine.relayout({ travel: 400 });

    // Still the width it was drawn at, then narrowing back towards where it began.
    expect(engine.visualOf(nodes()[0]).width).toBeCloseTo(caught);
    await vi.advanceTimersByTimeAsync(600);
    drew(engine);
    expect(engine.visualOf(nodes()[0]).width).toBe(100);
  });
});
