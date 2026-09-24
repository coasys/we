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
