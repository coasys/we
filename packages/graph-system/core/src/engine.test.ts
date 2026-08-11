/**
 * Engine tests, against a fake expander and no DOM.
 *
 * The point of a framework-neutral core is that its hardest behaviour — budgets, auto-expansion,
 * collapse round-tripping — is testable without mounting anything. If any of this needed a browser to
 * verify, the layering would have failed.
 */
import type { Expander, ExpanderContext, SeedSource } from '@we/graph-protocol';
import { describe, expect, it } from 'vitest';

import { GraphEngine } from './engine';
import { PluginRegistry } from './registry';

const context: ExpanderContext = {
  query: async () => [],
  defaultDataset: () => 'ds',
  models: () => [],
  warn: () => undefined,
};

function seedOf(count: number): SeedSource {
  return {
    id: 'test',
    async seed() {
      return {
        nodes: Array.from({ length: count }, (_, i) => ({
          id: `seed-${i}`,
          kind: 'entity' as const,
          type: 'Thing',
          label: `seed ${i}`,
        })),
        edges: [],
      };
    },
  };
}

/** Each expansion mints `fanout` fresh children — the shape that finds budget and cascade bugs. */
function fanoutExpander(fanout: number, total?: number): Expander {
  return {
    id: 'fanout',
    kinds: ['entity'],
    async expand(request) {
      const children = Array.from({ length: fanout }, (_, i) => ({
        id: `${request.id}/c${i}`,
        kind: 'entity' as const,
        type: 'Thing',
        label: `${request.id}/c${i}`,
      }));
      return {
        nodes: children,
        edges: children.map((child) => ({
          id: `${request.id}->${child.id}`,
          source: request.id,
          target: child.id,
          type: 'rel',
        })),
        total,
      };
    },
  };
}

function engineWith(spec: Parameters<typeof GraphEngine.prototype.setSpec>[0], plugins: PluginRegistry) {
  return new GraphEngine({ spec, registry: plugins, context });
}

const layouts = {
  // A trivial deterministic layout: the engine's behaviour under test is expansion, not positioning.
  grid: () => ({
    id: 'grid',
    init(input: { nodes: { id: string }[] }) {
      return {
        positions: new Map(input.nodes.map((node, index) => [node.id, { x: index * 10, y: 0 }])),
      };
    },
  }),
};

describe('GraphEngine', () => {
  it('loads seeds and leaves them unexpanded at depth 0', async () => {
    const registry = new PluginRegistry({ seeds: [seedOf(3)], expanders: [fanoutExpander(2)], layouts });
    const engine = engineWith(
      { seeds: { source: 'test' }, layout: { type: 'grid' }, expansion: { defaultDepth: 0 } },
      registry,
    );

    await engine.start();

    expect(engine.store.nodeCount).toBe(3);
    expect(engine.getPositions().size).toBe(3);
  });

  it('auto-expands to the requested depth', async () => {
    const registry = new PluginRegistry({ seeds: [seedOf(1)], expanders: [fanoutExpander(2)], layouts });
    const engine = engineWith(
      { seeds: { source: 'test' }, layout: { type: 'grid' }, expansion: { defaultDepth: 2 } },
      registry,
    );

    await engine.start();

    // 1 seed + 2 children + 4 grandchildren.
    expect(engine.store.nodeCount).toBe(7);
  });

  it('stops at the node budget and reports it rather than truncating silently', async () => {
    const registry = new PluginRegistry({ seeds: [seedOf(1)], expanders: [fanoutExpander(50)], layouts });
    const engine = engineWith(
      { seeds: { source: 'test' }, layout: { type: 'grid' }, expansion: { defaultDepth: 3, maxNodes: 20 } },
      registry,
    );

    await engine.start();

    expect(engine.store.nodeCount).toBeLessThanOrEqual(20);
    expect(engine.getStatus().budgetReached).toBe(true);
  });

  it('restores the graph after collapsing and re-expanding', async () => {
    const registry = new PluginRegistry({ seeds: [seedOf(1)], expanders: [fanoutExpander(3)], layouts });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'grid' } }, registry);

    await engine.start();
    await engine.expand('seed-0');
    expect(engine.store.nodeCount).toBe(4);

    engine.collapse('seed-0');
    expect(engine.store.nodeCount).toBe(1);

    await engine.expand('seed-0');
    expect(engine.store.nodeCount).toBe(4);
  });

  it('clears the budget flag once collapsing brings the graph back under the ceiling', async () => {
    const registry = new PluginRegistry({ seeds: [seedOf(1)], expanders: [fanoutExpander(30)], layouts });
    const engine = engineWith(
      { seeds: { source: 'test' }, layout: { type: 'grid' }, expansion: { maxNodes: 20 } },
      registry,
    );

    await engine.start();
    await engine.expand('seed-0');
    expect(engine.getStatus().budgetReached).toBe(true);

    engine.collapse('seed-0');
    expect(engine.getStatus().budgetReached).toBe(false);
  });

  it('does not re-expand a node that has nothing more to give', async () => {
    const registry = new PluginRegistry({ seeds: [seedOf(1)], expanders: [fanoutExpander(2)], layouts });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'grid' } }, registry);

    await engine.start();
    await engine.expand('seed-0');
    const afterFirst = engine.store.nodeCount;
    await engine.expand('seed-0');

    expect(engine.store.nodeCount).toBe(afterFirst);
  });

  it('warns rather than throwing when a seed source is not registered', async () => {
    const engine = engineWith({ seeds: { source: 'nope' }, layout: { type: 'grid' } }, new PluginRegistry({ layouts }));

    await engine.start();

    expect(engine.store.nodeCount).toBe(0);
    expect(engine.getStatus().warnings.join(' ')).toContain('nope');
  });

  it('warns rather than throwing when an expander fails', async () => {
    const failing: Expander = {
      id: 'failing',
      kinds: ['entity'],
      async expand() {
        throw new Error('backend unavailable');
      },
    };
    const registry = new PluginRegistry({ seeds: [seedOf(1)], expanders: [failing], layouts });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'grid' } }, registry);

    await engine.start();
    await engine.expand('seed-0');

    expect(engine.getStatus().warnings.join(' ')).toContain('backend unavailable');
    expect(engine.store.nodeCount).toBe(1);
  });

  it('exposes selection through the behaviour context', async () => {
    const registry = new PluginRegistry({ seeds: [seedOf(2)], layouts });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'grid' } }, registry);
    await engine.start();

    const ctx = engine.behaviourContext();
    ctx.select(['seed-0']);
    expect(ctx.selection()).toEqual(['seed-0']);

    ctx.select(['seed-1'], 'add');
    expect(ctx.selection().sort()).toEqual(['seed-0', 'seed-1']);

    ctx.select(['seed-0'], 'toggle');
    expect(ctx.selection()).toEqual(['seed-1']);
  });
});

describe('the scene stays consistent with what is drawn', () => {
  it('re-indexes after a pin, so a dragged node is hittable where it was dropped', async () => {
    // The bug this pins down: `pin` moved the node visually and left the spatial index holding its
    // old position, so hover and a second drag both missed it. Invisible under force layout, which
    // re-indexes on the next tick; permanent under a layout that computes once.
    const registry = new PluginRegistry({ seeds: [seedOf(2)], layouts });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'grid' } }, registry);
    await engine.start();
    engine.resize(800, 600);

    engine.pin('seed-0', { x: 400, y: 400 });

    expect(engine.index.hitTest({ x: 400, y: 400 })).toContain('seed-0');
    expect(engine.index.hitTest({ x: 0, y: 0 })).not.toContain('seed-0');
  });

  it('re-indexes when a pin is released', async () => {
    const registry = new PluginRegistry({ seeds: [seedOf(1)], layouts });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'grid' } }, registry);
    await engine.start();
    engine.resize(800, 600);

    engine.pin('seed-0', { x: 250, y: 250 });
    engine.pin('seed-0', null);

    expect(engine.index.hitTest({ x: 250, y: 250 })).toContain('seed-0');
  });

  it('sizes the hit area from the node style rather than a fixed radius', async () => {
    const registry = new PluginRegistry({ seeds: [seedOf(1)], layouts });
    const engine = engineWith(
      {
        seeds: { source: 'test' },
        layout: { type: 'grid' },
        nodeStyle: [{ style: { size: 40 } }],
      },
      registry,
    );
    await engine.start();
    engine.resize(800, 600);
    engine.pin('seed-0', { x: 0, y: 0 });

    // Inside a 40px node, outside the 18px radius this used to hardcode.
    expect(engine.index.hitTest({ x: 30, y: 0 })).toContain('seed-0');
    expect(engine.index.hitTest({ x: 80, y: 0 })).not.toContain('seed-0');
  });
});

describe('framing', () => {
  it('applies a fit that was asked for before the surface had been measured', async () => {
    // The bug: `start()` requests a fit, but a renderer has not measured itself yet, and
    // `Viewport.fit` cannot frame into a zero-sized box. The request was dropped, the camera stayed
    // at the origin, and every deterministic layout ended up in the top-left corner.
    const registry = new PluginRegistry({ seeds: [seedOf(6)], layouts });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'grid' } }, registry);

    await engine.start();
    expect(engine.viewport.get()).toMatchObject({ x: 0, y: 0, zoom: 1 });

    engine.resize(800, 600);

    const camera = engine.viewport.get();
    expect(camera.x === 0 && camera.y === 0).toBe(false);
  });

  it('centres the content it framed', async () => {
    const registry = new PluginRegistry({ seeds: [seedOf(6)], layouts });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'grid' } }, registry);
    await engine.start();
    engine.resize(800, 600);

    const positions = [...engine.getPositions().values()];
    const midX = (Math.min(...positions.map((p) => p.x)) + Math.max(...positions.map((p) => p.x))) / 2;
    const midY = (Math.min(...positions.map((p) => p.y)) + Math.max(...positions.map((p) => p.y))) / 2;
    const onScreen = engine.viewport.toScreen({ x: midX, y: midY });

    expect(onScreen.x).toBeCloseTo(400, 0);
    expect(onScreen.y).toBeCloseTo(300, 0);
  });

  it('does not re-frame on an ordinary resize, which would yank the camera mid-exploration', async () => {
    const registry = new PluginRegistry({ seeds: [seedOf(4)], layouts });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'grid' } }, registry);
    await engine.start();
    engine.resize(800, 600);

    engine.behaviourContext().pan(120, 90);
    const panned = { ...engine.viewport.get() };
    engine.resize(820, 610);

    expect(engine.viewport.get().x).toBe(panned.x);
    expect(engine.viewport.get().y).toBe(panned.y);
  });

  it('frames on demand', async () => {
    const registry = new PluginRegistry({ seeds: [seedOf(4)], layouts });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'grid' } }, registry);
    await engine.start();
    engine.resize(800, 600);
    engine.behaviourContext().pan(500, 500);

    engine.fit();

    expect(engine.viewport.get().x).not.toBe(500);
  });
});

describe('hit areas follow what is drawn', () => {
  it('picks a card across its whole box, not a dot in the middle', async () => {
    // The bug: hit size was read off the raw style rules, and a card sets `width`, never `size` — so
    // it fell through to the default and gave a 170px card an 18px grab spot in its centre.
    const registry = new PluginRegistry({ seeds: [seedOf(1)], layouts });
    const engine = engineWith(
      {
        seeds: { source: 'test' },
        layout: { type: 'grid' },
        nodeStyle: [{ style: { shape: 'card', width: 170, height: 120 } }],
      },
      registry,
    );
    await engine.start();
    engine.resize(800, 600);
    engine.pin('seed-0', { x: 0, y: 0 });

    // Anywhere inside the box.
    expect(engine.index.hitTest({ x: 80, y: 55 })).toContain('seed-0');
    expect(engine.index.hitTest({ x: -80, y: -55 })).toContain('seed-0');
    // And nowhere outside it — a circle of the same reach would have claimed this.
    expect(engine.index.hitTest({ x: 0, y: 75 })).not.toContain('seed-0');
  });

  it('keeps a circular hit area for ordinary marks', async () => {
    const registry = new PluginRegistry({ seeds: [seedOf(1)], layouts });
    const engine = engineWith(
      { seeds: { source: 'test' }, layout: { type: 'grid' }, nodeStyle: [{ style: { size: 20 } }] },
      registry,
    );
    await engine.start();
    engine.resize(800, 600);
    engine.pin('seed-0', { x: 0, y: 0 });

    expect(engine.index.hitTest({ x: 18, y: 0 })).toContain('seed-0');
    expect(engine.index.hitTest({ x: 40, y: 0 })).not.toContain('seed-0');
  });

  it('does not let a wide card swallow the node beside it', async () => {
    // On a board cards sit close together, and a click landing on the wrong one is worse than a click
    // landing on nothing.
    const registry = new PluginRegistry({ seeds: [seedOf(2)], layouts });
    const engine = engineWith(
      {
        seeds: { source: 'test' },
        layout: { type: 'grid' },
        nodeStyle: [{ style: { shape: 'card', width: 100, height: 60 } }],
      },
      registry,
    );
    await engine.start();
    engine.resize(800, 600);
    engine.pin('seed-0', { x: 0, y: 0 });
    engine.pin('seed-1', { x: 200, y: 0 });

    expect(engine.index.hitTest({ x: 120, y: 0 })).toEqual([]);
  });
});
