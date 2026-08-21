/**
 * Engine tests, against a fake expander and no DOM.
 *
 * The point of a framework-neutral core is that its hardest behaviour — budgets, auto-expansion,
 * collapse round-tripping — is testable without mounting anything. If any of this needed a browser to
 * verify, the layering would have failed.
 */
import type { Expander, ExpanderContext, SeedSource } from '@we/graph-protocol';
import { describe, expect, it, vi } from 'vitest';

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
  /*
    A trivial deterministic layout: the engine's behaviour under test is expansion, not positioning.

    It honours `previous` for anything it has already placed, which is not decoration — every real
    layout warm-starts, and a fake that re-derived every position from scratch would let the engine
    lose placements no shipped layout would lose, so a test written against it would pass while the
    app moved every node on every update.
  */
  grid: () => ({
    id: 'grid',
    init(input: { nodes: { id: string }[]; previous?: ReadonlyMap<string, { x: number; y: number }> }) {
      return {
        positions: new Map(
          input.nodes.map((node, index) => [node.id, input.previous?.get(node.id) ?? { x: index * 10, y: 0 }]),
        ),
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

/**
 * A seed source whose rows can change between runs — what a live query looks like from the engine's
 * side, and the only way to test that a refresh reconciles rather than restarts.
 */
function mutableSeed(initial: string[]): SeedSource & { rows: string[] } {
  const source = {
    id: 'test',
    rows: [...initial],
    async seed() {
      return {
        nodes: source.rows.map((id) => ({ id, kind: 'entity' as const, type: 'Thing', label: id })),
        edges: [],
      };
    },
  };
  return source;
}

describe('refreshing keeps the graph the user is looking at', () => {
  it('adds a new row without disturbing what is already placed', async () => {
    const seed = mutableSeed(['seed-0', 'seed-1']);
    const registry = new PluginRegistry({ seeds: [seed], layouts });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'grid' } }, registry);
    await engine.start();
    engine.resize(800, 600);
    engine.pin('seed-0', { x: 123, y: 456 });

    seed.rows.push('seed-2');
    await engine.refresh();

    expect(engine.store.nodeCount).toBe(3);
    expect(engine.store.hasNode('seed-2')).toBe(true);
    // The whole reason `refresh` exists rather than a second `start`: a position somebody chose has
    // to survive somebody else's write.
    expect(engine.getPositions().get('seed-0')).toMatchObject({ x: 123, y: 456 });
    expect(engine.isPinned('seed-0')).toBe(true);
  });

  it('drops a row the seeds no longer return, with its position and selection', async () => {
    const seed = mutableSeed(['seed-0', 'seed-1']);
    const registry = new PluginRegistry({ seeds: [seed], layouts });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'grid' } }, registry);
    await engine.start();
    engine.select(['seed-1']);

    seed.rows = ['seed-0'];
    await engine.refresh();

    expect(engine.store.hasNode('seed-1')).toBe(false);
    expect(engine.getPositions().has('seed-1')).toBe(false);
    expect(engine.getSelection()).toEqual([]);
  });

  it('keeps a vanished seed row that an expansion is still holding open', async () => {
    // Two openers on one node is the ordinary case, and the reason release is reference-counted
    // rather than a set difference: the seed query no longer returns it, but the user opened the
    // node it hangs off, and deleting it would take a node off screen that they put there.
    const seed = mutableSeed(['seed-0']);
    const registry = new PluginRegistry({
      seeds: [seed],
      expanders: [
        {
          id: 'to-shared',
          kinds: ['entity'],
          async expand(request) {
            return {
              nodes: [{ id: 'shared', kind: 'entity' as const, type: 'Thing', label: 'shared' }],
              edges: [{ id: `${request.id}->shared`, source: request.id, target: 'shared', type: 'rel' }],
            };
          },
        },
      ],
      layouts,
    });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'grid' } }, registry);
    await engine.start();
    await engine.expand('seed-0');
    seed.rows = ['seed-0', 'shared'];
    await engine.refresh();

    seed.rows = ['seed-0'];
    await engine.refresh();

    expect(engine.store.hasNode('shared')).toBe(true);
  });

  it('does not re-open a node the user collapsed', async () => {
    // Auto-expansion over the whole store on every refresh would make a collapsed node spring back
    // the next time anything changed, which reads as the graph refusing to be closed.
    const seed = mutableSeed(['seed-0']);
    const registry = new PluginRegistry({ seeds: [seed], expanders: [fanoutExpander(2)], layouts });
    const engine = engineWith(
      { seeds: { source: 'test' }, layout: { type: 'grid' }, expansion: { defaultDepth: 1 } },
      registry,
    );
    await engine.start();
    expect(engine.store.nodeCount).toBe(3);

    engine.collapse('seed-0');
    expect(engine.store.nodeCount).toBe(1);

    await engine.refresh();

    expect(engine.store.nodeCount).toBe(1);
  });

  it('auto-expands rows that arrive, so a new node opens like the ones loaded with it', async () => {
    const seed = mutableSeed(['seed-0']);
    const registry = new PluginRegistry({ seeds: [seed], expanders: [fanoutExpander(2)], layouts });
    const engine = engineWith(
      { seeds: { source: 'test' }, layout: { type: 'grid' }, expansion: { defaultDepth: 1 } },
      registry,
    );
    await engine.start();

    seed.rows.push('seed-1');
    await engine.refresh();

    // 2 seeds, each with 2 children.
    expect(engine.store.nodeCount).toBe(6);
  });

  it('collapses concurrent refreshes into one more pass rather than racing', async () => {
    const seed = mutableSeed(['seed-0']);
    let runs = 0;
    const counted: SeedSource = {
      id: 'test',
      async seed() {
        runs += 1;
        return seed.seed();
      },
    };
    const registry = new PluginRegistry({ seeds: [counted], layouts });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'grid' } }, registry);
    await engine.start();
    runs = 0;

    await Promise.all([engine.refresh(), engine.refresh(), engine.refresh()]);

    // One in flight plus one pass for everything that arrived while it ran — not three.
    expect(runs).toBe(2);
  });
});

/**
 * A host that can report changes, and a seed that reads through the context so the engine can see
 * what it read. The engine derives its watches from the reads themselves, so a seed that fabricates
 * nodes without querying — every other seed in this file — is correctly watched for nothing.
 */
function watchableFixture(entity: string) {
  const fired: (() => void)[] = [];
  const watched: { entity: string; dataset?: string }[] = [];
  let stopped = 0;

  const context: ExpanderContext = {
    query: async () => [{ id: 'row-1' }],
    defaultDataset: () => 'ds',
    models: () => [],
    warn: () => undefined,
    watch(request, onChange) {
      watched.push(request);
      fired.push(onChange);
      return () => {
        stopped += 1;
      };
    },
  };

  const seed: SeedSource = {
    id: 'test',
    async seed(_options, ctx) {
      const rows = await ctx.query({ entity, dataset: 'ds' });
      return {
        nodes: rows.map((row) => ({
          id: String((row as { id: string }).id),
          kind: 'entity' as const,
          type: entity,
        })),
        edges: [],
      };
    },
  };

  return { context, seed, watched, fired, stopped: () => stopped };
}

describe('following the data', () => {
  it('watches exactly the types the seeds read', async () => {
    const fixture = watchableFixture('Post');
    const registry = new PluginRegistry({ seeds: [fixture.seed], layouts });
    const engine = new GraphEngine({
      spec: { seeds: { source: 'test' }, layout: { type: 'grid' } },
      registry,
      context: fixture.context,
    });

    await engine.start();

    expect(fixture.watched).toEqual([{ entity: 'Post', dataset: 'ds' }]);
  });

  it('re-reads when a watch fires, and coalesces a burst into one pass', async () => {
    vi.useFakeTimers();
    try {
      const fixture = watchableFixture('Post');
      const registry = new PluginRegistry({ seeds: [fixture.seed], layouts });
      const engine = new GraphEngine({
        spec: { seeds: { source: 'test' }, layout: { type: 'grid' } },
        registry,
        context: fixture.context,
      });
      await engine.start();

      const refresh = vi.spyOn(engine, 'refresh');
      // One user action is many writes. Three notifications must not be three rounds of queries.
      fixture.fired[0]();
      fixture.fired[0]();
      fixture.fired[0]();
      await vi.advanceTimersByTimeAsync(500);

      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('watches nothing when the template asked for a graph that holds still', async () => {
    const fixture = watchableFixture('Post');
    const registry = new PluginRegistry({ seeds: [fixture.seed], layouts });
    const engine = new GraphEngine({
      spec: { seeds: { source: 'test' }, layout: { type: 'grid' }, live: false },
      registry,
      context: fixture.context,
    });

    await engine.start();

    expect(fixture.watched).toEqual([]);
  });

  it('starts and stops watching as live is toggled, without re-running the queries', async () => {
    const fixture = watchableFixture('Post');
    const registry = new PluginRegistry({ seeds: [fixture.seed], layouts });
    const engine = new GraphEngine({
      spec: { seeds: { source: 'test' }, layout: { type: 'grid' }, live: false },
      registry,
      context: fixture.context,
    });
    await engine.start();

    engine.setLive(true);
    expect(fixture.watched).toHaveLength(1);

    engine.setLive(false);
    expect(fixture.stopped()).toBe(1);
  });

  it('releases its watches when disposed', async () => {
    // A leaked watch keeps the whole engine reachable from a backend subscription — the shape of
    // leak that only ever shows up as an app that gets slower the longer it runs.
    const fixture = watchableFixture('Post');
    const registry = new PluginRegistry({ seeds: [fixture.seed], layouts });
    const engine = new GraphEngine({
      spec: { seeds: { source: 'test' }, layout: { type: 'grid' } },
      registry,
      context: fixture.context,
    });
    await engine.start();

    engine.dispose();

    expect(fixture.stopped()).toBe(1);
  });
});

describe('warnings', () => {
  /** A layout that complains on demand, so the engine's handling of what it says is under test. */
  function complaining(message: () => string | null) {
    return {
      grid: () => ({
        id: 'grid',
        init(inputNodes: { nodes: { id: string }[] }) {
          const said = message();
          return {
            positions: new Map(inputNodes.nodes.map((n, i) => [n.id, { x: i * 10, y: 0 }])),
            ...(said ? { warnings: [said] } : {}),
          };
        },
      }),
    };
  }

  it('retires a layout warning once a later arrangement no longer makes it', async () => {
    // The bug this pins: a complaint true of an empty board stayed on screen after the first drag
    // made it false. A layout warning describes the arrangement *as it is now*, so a later
    // arrangement supersedes it — otherwise a reader cannot tell a live warning from a spent one.
    let say: string | null = 'nothing carries a position';
    const registry = new PluginRegistry({ seeds: [seedOf(2)], layouts: complaining(() => say) });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'grid' } }, registry);

    await engine.start();
    expect(engine.getStatus().warnings).toContain('nothing carries a position');

    say = null;
    engine.relayout();

    expect(engine.getStatus().warnings).toEqual([]);
  });

  it('keeps an expander warning across a re-layout, because an event does not un-happen', async () => {
    // The other half of the rule. A query that failed stays failed; only the layout's description of
    // the current arrangement is superseded by a new one.
    const registry = new PluginRegistry({
      seeds: [seedOf(1)],
      expanders: [
        {
          id: 'broken',
          kinds: ['entity'],
          async expand() {
            throw new Error('backend unavailable');
          },
        },
      ],
      layouts: complaining(() => null),
    });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'grid' } }, registry);
    await engine.start();
    await engine.expand('seed-0');

    engine.relayout();

    expect(engine.getStatus().warnings.join(' ')).toContain('backend unavailable');
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

describe('edge picking', () => {
  /** A layout that puts two nodes at known places, so an edge's route is predictable. */
  const placed = {
    grid: () => ({
      id: 'grid',
      init(input: { nodes: { id: string }[] }) {
        return {
          positions: new Map(input.nodes.map((node, index) => [node.id, { x: index * 300, y: 0 }])),
        };
      },
    }),
  };

  function linkedSeed(): SeedSource {
    return {
      id: 'linked',
      async seed() {
        return {
          nodes: [
            { id: 'a', kind: 'entity' as const, type: 'Thing', label: 'a' },
            { id: 'b', kind: 'entity' as const, type: 'Thing', label: 'b' },
          ],
          edges: [{ id: 'a-b', source: 'a', target: 'b', type: 'rel' }],
        };
      },
    };
  }

  it('finds an edge by geometry, not by the DOM', async () => {
    // Edges used to be picked by `pointer-events: stroke` on an SVG path, which meant the DOM owned
    // hit-testing for the one thing nodes did not — and a canvas renderer could never have supported
    // clicking one.
    const registry = new PluginRegistry({ seeds: [linkedSeed()], layouts: placed });
    const engine = engineWith(
      { seeds: { source: 'linked' }, layout: { type: 'grid' }, edgeStyle: [{ style: { curve: 'straight' } }] },
      registry,
    );
    await engine.start();
    engine.resize(800, 600);

    expect(engine.hitTestEdge({ x: 150, y: 0 })).toBe('a-b');
    expect(engine.hitTestEdge({ x: 150, y: 200 })).toBeNull();
  });

  it('measures against the curve a bowed edge actually follows', async () => {
    const registry = new PluginRegistry({ seeds: [linkedSeed()], layouts: placed });
    const engine = engineWith(
      { seeds: { source: 'linked' }, layout: { type: 'grid' }, edgeStyle: [{ style: { curve: 'arc' } }] },
      registry,
    );
    await engine.start();
    engine.resize(800, 600);

    const route = engine.getEdgeGeometry().get('a-b');
    expect(route?.control).toBeDefined();
    // On the curve, at its own midpoint.
    expect(engine.hitTestEdge(route!.mid)).toBe('a-b');
  });

  it('re-routes when nodes move, so picking follows the drawing', async () => {
    const registry = new PluginRegistry({ seeds: [linkedSeed()], layouts: placed });
    const engine = engineWith({ seeds: { source: 'linked' }, layout: { type: 'grid' } }, registry);
    await engine.start();
    engine.resize(800, 600);
    const before = engine.getEdgeGeometry().get('a-b')!.to;

    engine.pin('b', { x: 0, y: 400 });

    expect(engine.getEdgeGeometry().get('a-b')!.to).not.toEqual(before);
  });

  it('stops short of the target so an arrowhead lands on the node, not under it', async () => {
    const registry = new PluginRegistry({ seeds: [linkedSeed()], layouts: placed });
    const engine = engineWith(
      { seeds: { source: 'linked' }, layout: { type: 'grid' }, nodeStyle: [{ style: { size: 30 } }] },
      registry,
    );
    await engine.start();
    engine.resize(800, 600);

    // Target sits at x=300; the route must end before it.
    expect(engine.getEdgeGeometry().get('a-b')!.to.x).toBeLessThan(300 - 30);
  });
});

describe('re-tuning a layout', () => {
  /*
    A layout is constructed with its options and holds them, so reusing a live instance whenever the
    type happened to match meant a spec that re-tuned a layout was ignored. Everything downstream
    looked right — the spec updated, `relayout` ran, positions were reapplied — and nothing moved.

    It presented as a layout picker that worked from every layout except the one already in use, and
    it would have silently swallowed any template changing `levelGap` or `columns` on its own.
  */
  const spaced = {
    spaced: (options?: { gap?: number }) => ({
      id: 'spaced',
      init(input: { nodes: { id: string }[] }) {
        const gap = options?.gap ?? 10;
        return { positions: new Map(input.nodes.map((node, index) => [node.id, { x: index * gap, y: 0 }])) };
      },
    }),
  };

  it('rebuilds the layout when only its options change', async () => {
    const plugins = new PluginRegistry({ seeds: [seedOf(3)], layouts: spaced });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'spaced', options: { gap: 10 } } }, plugins);
    await engine.start();
    expect(engine.getPositions().get('seed-2')?.x).toBe(20);

    engine.setSpec({ seeds: { source: 'test' }, layout: { type: 'spaced', options: { gap: 50 } } });
    engine.relayout();
    expect(engine.getPositions().get('seed-2')?.x).toBe(100);
  });

  it('keeps the live layout when nothing about it changed', async () => {
    let built = 0;
    const counted = {
      counted: () => {
        built += 1;
        return {
          id: 'counted',
          init: (input: { nodes: { id: string }[] }) => ({
            positions: new Map(input.nodes.map((node, index) => [node.id, { x: index, y: 0 }])),
          }),
        };
      },
    };
    const plugins = new PluginRegistry({ seeds: [seedOf(3)], layouts: counted });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'counted' } }, plugins);
    await engine.start();
    const afterStart = built;

    engine.relayout();
    // A warm layout is the whole reason expansion does not make the map jump; rebuilding on every
    // call would throw that away.
    expect(built).toBe(afterStart);
  });
});

describe('a layout that is still settling', () => {
  /**
   * Starts compact and spreads a long way over its next few ticks — a force simulation in miniature,
   * and the shape that tells a camera which follows from one that frames once and stops.
   */
  function drifting() {
    return {
      drift: () => {
        let tick = 0;
        let nodes: { id: string }[] = [];
        const place = () => new Map(nodes.map((node, index) => [node.id, { x: index * 400 * tick, y: 0 }]));
        return {
          id: 'drift',
          init(input: { nodes: { id: string }[] }) {
            nodes = input.nodes;
            tick = 0;
            return { positions: place(), running: true };
          },
          tick() {
            tick += 1;
            return { positions: place(), running: tick < 4 };
          },
        };
      },
    };
  }

  /*
    Fitting once at `init` frames where a simulation *starts*, and it then spends a second or two
    spreading out from under the camera. That reads as the graph wandering off into a corner, which is
    a fair description of what has happened: the camera stopped following it.
  */
  it('still has the graph on screen once the layout settles', async () => {
    const plugins = new PluginRegistry({ seeds: [seedOf(4)], layouts: drifting() });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'drift' } }, plugins);
    engine.resize(800, 600);
    await engine.start();
    await new Promise((resolve) => setTimeout(resolve, 150));

    const view = engine.viewport.visibleBounds();
    for (const [id, at] of engine.getPositions()) {
      expect(at.x, `${id} is off screen`).toBeGreaterThanOrEqual(view.minX);
      expect(at.x, `${id} is off screen`).toBeLessThanOrEqual(view.maxX);
    }
  });

  it('reports what a layout could not do, rather than leaving it to look like nothing happened', async () => {
    const plugins = new PluginRegistry({
      seeds: [seedOf(2)],
      layouts: {
        picky: () => ({
          id: 'picky',
          init: (input: { nodes: { id: string }[] }) => ({
            positions: new Map(input.nodes.map((node) => [node.id, { x: 0, y: 0 }])),
            warnings: ['nothing to read'],
          }),
        }),
      },
    });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'picky' } }, plugins);
    await engine.start();

    expect(engine.getStatus().warnings).toContain('nothing to read');
  });
});

describe('whether being pinned is worth showing', () => {
  /*
    A held node is worth marking because the layout would otherwise move it. Under a layout that reads
    positions from the data there is nothing to be held against — every node is placed by definition —
    so the same mark lands on all of them and says nothing, which reads as every card being in some
    special state rather than as none of them being.
  */
  const layouts = {
    derived: () => ({
      id: 'derived',
      init: (input: { nodes: { id: string }[] }) => ({
        positions: new Map(input.nodes.map((node, index) => [node.id, { x: index, y: 0 }])),
      }),
    }),
    fromData: () => ({
      id: 'fromData',
      derivesPositions: false,
      init: (input: { nodes: { id: string }[] }) => ({
        positions: new Map(input.nodes.map((node, index) => [node.id, { x: index, y: 0, fixed: true }])),
      }),
    }),
  };

  it('is worth showing under a layout that works out where things go', async () => {
    const plugins = new PluginRegistry({ seeds: [seedOf(2)], layouts });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'derived' } }, plugins);
    await engine.start();
    expect(engine.pinningIsMeaningful()).toBe(true);
  });

  it('is not, under a layout that reads them from the data', async () => {
    const plugins = new PluginRegistry({ seeds: [seedOf(2)], layouts });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'fromData' } }, plugins);
    await engine.start();
    expect(engine.pinningIsMeaningful()).toBe(false);
  });
});

describe('a settled layout that is given a reason to move', () => {
  /*
    A force simulation re-energises itself when a node is held or released — that is what makes the
    rest of a graph flow around the one being dragged. The engine stops polling once a layout reports
    itself settled, so without resuming it the reheat went nowhere: the dragged node moved and nothing
    else responded, which makes a force layout look deterministic and makes pinning look inert.
  */
  function reheating() {
    return {
      reheat: () => {
        // `energy` settles and can be topped up; `moved` only ever counts up, so "it started moving
        // again" is distinguishable from "it moved the same amount a second time".
        let energy = 3;
        let moved = 0;
        let nodes: { id: string }[] = [];
        const place = () => new Map(nodes.map((node) => [node.id, { x: moved * 10, y: 0 }]));
        return {
          id: 'reheat',
          init(input: { nodes: { id: string }[] }) {
            nodes = input.nodes;
            return { positions: place(), running: false };
          },
          tick() {
            energy += 1;
            moved += 1;
            return { positions: place(), running: energy < 3 };
          },
          fix() {
            energy = 0;
          },
        };
      },
    };
  }

  it('starts moving again when a node is pinned', async () => {
    const plugins = new PluginRegistry({ seeds: [seedOf(2)], layouts: reheating() });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'reheat' } }, plugins);
    await engine.start();
    expect(engine.getPositions().get('seed-0')?.x).toBe(0);

    engine.pin('seed-0', { x: 500, y: 500 });
    await new Promise((resolve) => setTimeout(resolve, 100));

    // The layout kept being polled after the pin, rather than the reheat going nowhere.
    expect(engine.getPositions().get('seed-1')?.x).toBeGreaterThan(0);
  });

  it('starts moving again when one is released', async () => {
    const plugins = new PluginRegistry({ seeds: [seedOf(2)], layouts: reheating() });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'reheat' } }, plugins);
    await engine.start();

    engine.setPinned(['seed-0'], true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const held = engine.getPositions().get('seed-1')?.x ?? 0;

    engine.setPinned(['seed-0'], false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(engine.getPositions().get('seed-1')?.x).toBeGreaterThan(held);
  });
});
