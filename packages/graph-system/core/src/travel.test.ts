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
