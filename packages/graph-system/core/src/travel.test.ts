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

    engine.setSpec(spec('right', 200, 'triangle'));
    engine.relayout({ travel: 400 });
    await vi.advanceTimersByTimeAsync(200);

    expect(engine.visualOf(nodes()[0]).morph).toBeUndefined();
    expect(engine.visualOf(nodes()[0]).width).toBe(200);
  });

  it('does not hold a restyling nobody travelled away from', async () => {
    const engine = await started(spec('left', 100));

    // A restyling on its own — a card resized on a canvas. No travel follows it.
    engine.setSpec(spec('left', 300));
    engine.relayout({});
    expect(engine.visualOf(nodes()[0]).width).toBe(300);

    /*
      A later rearrangement with no restyling behind it must not resurrect that one. Held, this is a
      card easing out of a width it left two actions ago — correct-looking code producing a movement
      nobody asked for.
    */
    engine.setSpec({ ...spec('right', 300), nodeStyle: spec('left', 300).nodeStyle });
    engine.relayout({ travel: 400 });
    await vi.advanceTimersByTimeAsync(200);
    expect(engine.visualOf(nodes()[0]).width).toBe(300);
  });

  it('is pickable at the box it is drawn at, not the one it is heading for', async () => {
    const engine = await started(spec('left', 100));

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
