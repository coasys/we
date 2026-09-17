/**
 * Engine tests, against a fake expander and no DOM.
 *
 * The point of a framework-neutral core is that its hardest behaviour — budgets, auto-expansion,
 * collapse round-tripping — is testable without mounting anything. If any of this needed a browser to
 * verify, the layering would have failed.
 */
import type { Expander, ExpanderContext, GraphValue, SeedSource } from '@we/graph-protocol';
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
      // Forwards what it was handed rather than calling bare: `SeedSource.seed` takes options and a
      // context, and a counting wrapper that drops them is only accidentally equivalent to the thing
      // it wraps — today, because `mutableSeed` reads neither.
      async seed(options, context, signal) {
        runs += 1;
        return seed.seed(options, context, signal);
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
function watchableFixture(entity: string, read: Record<string, unknown> = {}) {
  const fired: (() => void)[] = [];
  const watched: Record<string, unknown>[] = [];
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
      const rows = await ctx.query({ entity, dataset: 'ds', ...read });
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

  it('hands over the whole read, not only the type it was of', async () => {
    /*
      A host subscribes to what it is given, and a backend that reports "this query's answer
      changed" can say nothing about a query nobody asked. WE's does exactly that, so the coarse
      form — entity and dataset — became a one-row probe over the type, silent for every change
      that left that row alone: a canvas's second extracted record never appeared while the panel
      beside it, subscribed to its own narrower question, updated.
    */
    const fixture = watchableFixture('TaskBlock', {
      scope: { anchor: 'CollectionBlock', via: 'children', anchorId: 'call-1' },
      limit: 200,
    });
    const registry = new PluginRegistry({ seeds: [fixture.seed], layouts });
    const engine = new GraphEngine({
      spec: { seeds: { source: 'test' }, layout: { type: 'grid' } },
      registry,
      context: fixture.context,
    });

    await engine.start();

    expect(fixture.watched).toEqual([
      {
        entity: 'TaskBlock',
        dataset: 'ds',
        scope: { anchor: 'CollectionBlock', via: 'children', anchorId: 'call-1' },
        limit: 200,
      },
    ]);
    // The signal belongs to the load that made the read; a standing watch holding a spent one would
    // be subscribed on behalf of a fetch that is over.
    expect(fixture.watched[0]).not.toHaveProperty('signal');
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
    // The bug this pins: a complaint true of an empty canvas stayed on screen after the first drag
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

describe('how much of the graph a load covers', () => {
  /** Every status the engine published while `run` was in flight, in order. */
  async function statusesDuring(engine: GraphEngine, run: () => Promise<void>) {
    const seen: { loading: boolean; reloading: boolean }[] = [];
    const stop = engine.subscribe((reason) => {
      if (reason !== 'status') return;
      const { loading, reloading } = engine.getStatus();
      seen.push({ loading, reloading });
    });
    await run();
    stop();
    return seen;
  }

  it('reports a start as a reload, and clears both flags when it settles', async () => {
    const registry = new PluginRegistry({ seeds: [seedOf(1)], expanders: [fanoutExpander(2)], layouts });
    const engine = engineWith(
      { seeds: { source: 'test' }, layout: { type: 'grid' }, expansion: { defaultDepth: 1 } },
      registry,
    );

    const seen = await statusesDuring(engine, () => engine.start());

    expect(seen.some((s) => s.reloading)).toBe(true);
    expect(engine.getStatus()).toMatchObject({ loading: false, reloading: false });
  });

  it('holds the reload flag across the whole start, not just the seed load', async () => {
    // The gap this pins: seeds and auto-expansion are two loads, and the count released between them
    // published a settled frame in the middle of a start. A renderer reading that puts its "nothing
    // to show" state up over a graph that is still arriving.
    const registry = new PluginRegistry({ seeds: [seedOf(1)], expanders: [fanoutExpander(2)], layouts });
    const engine = engineWith(
      { seeds: { source: 'test' }, layout: { type: 'grid' }, expansion: { defaultDepth: 2 } },
      registry,
    );

    const seen = await statusesDuring(engine, () => engine.start());

    // Settling happens once, at the end — nowhere in the middle.
    expect(seen.filter((s) => !s.loading)).toHaveLength(1);
    expect(seen.at(-1)).toEqual({ loading: false, reloading: false });
  });

  it('reports an expansion as loading but not as a reload', async () => {
    // An expansion lands beside a graph that stays on screen and stays usable, which is the whole
    // distinction: nothing already drawn is being replaced, so it must not read as a reload.
    const registry = new PluginRegistry({ seeds: [seedOf(1)], expanders: [fanoutExpander(2)], layouts });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'grid' } }, registry);
    await engine.start();

    const seen = await statusesDuring(engine, () => engine.expand('seed-0'));

    expect(seen.some((s) => s.loading)).toBe(true);
    expect(seen.some((s) => s.reloading)).toBe(false);
  });

  it('reports a refresh as loading but not as a reload', async () => {
    // Same reasoning, and it matters more here: a refresh can arrive from a subscription while
    // somebody is reading, and treating that as a reload would dim the graph under them.
    const registry = new PluginRegistry({ seeds: [seedOf(2)], layouts });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'grid' } }, registry);
    await engine.start();

    const seen = await statusesDuring(engine, () => engine.refresh());

    expect(seen.some((s) => s.loading)).toBe(true);
    expect(seen.some((s) => s.reloading)).toBe(false);
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
    // On a canvas cards sit close together, and a click landing on the wrong one is worse than a click
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

  /*
    Dragging one end of a connection onto another card.

    The overlay is how that gesture is *seen*: the write goes round a peer-to-peer data layer and
    comes back through a re-seed, so without this the endpoint stays pinned to the card it came from
    for the whole drag and the gesture looks like it only ever offered that card's own four sides —
    which is exactly how it was reported.
  */
  function threeSeed(): SeedSource {
    return {
      id: 'linked',
      async seed() {
        return {
          nodes: ['a', 'b', 'c'].map((id) => ({ id, kind: 'entity' as const, type: 'Thing', label: id })),
          edges: [{ id: 'a-b', source: 'a', target: 'b', type: 'rel' }],
        };
      },
    };
  }

  async function threeNodeEngine() {
    const registry = new PluginRegistry({ seeds: [threeSeed()], layouts: placed });
    const engine = engineWith(
      { seeds: { source: 'linked' }, layout: { type: 'grid' }, edgeStyle: [{ style: { curve: 'straight' } }] },
      registry,
    );
    await engine.start();
    engine.resize(800, 600);
    return engine;
  }

  it('routes to the endpoint an overlay names, so a re-attachment can be previewed', async () => {
    const engine = await threeNodeEngine();
    // b sits at x=300, c at x=600.
    const before = engine.getEdgeGeometry().get('a-b')!.to.x;

    engine.setEdgeOverlay(new Map([['a-b', { target: 'c' }]]));

    expect(engine.getEdgeGeometry().get('a-b')!.to.x).toBeGreaterThan(before);
    // The claim itself is untouched — a released drag whose write fails leaves nothing to undo.
    expect(engine.store.edge('a-b')?.target).toBe('b');
  });

  it('keeps the stored endpoint when the overlay names an empty one', async () => {
    // How the anchor half of the same gesture says "not over another card": the field is present and
    // empty rather than absent, so merging one patch into the next cannot resurrect a stale landing.
    const engine = await threeNodeEngine();
    const before = engine.getEdgeGeometry().get('a-b')!.to;

    engine.setEdgeOverlay(new Map([['a-b', { target: '', targetAnchor: '' }]]));

    expect(engine.getEdgeGeometry().get('a-b')!.to).toEqual(before);
  });

  it('draws an end to a loose point, so dragging one is smooth rather than stepped', async () => {
    // A card has four sides and a canvas has however many cards, so an end that can only ever be on
    // one of those moves in jumps however finely the pointer does. The point IS the end here — no
    // clearance, or the line would trail the cursor by a gap that reads as lag.
    const engine = await threeNodeEngine();

    engine.setEdgeOverlay(new Map([['a-b', { targetX: 137, targetY: 42 }]]));

    expect(engine.getEdgeGeometry().get('a-b')!.to).toEqual({ x: 137, y: 42 });
  });

  it('ignores a pinned side at a loose end', async () => {
    // The fields still say `targetAnchor` while the drag is under way; honouring it would send the
    // line off north from wherever the cursor happens to be.
    const engine = await threeNodeEngine();

    engine.setEdgeOverlay(new Map([['a-b', { targetAnchor: 'n', targetX: 137, targetY: 42 }]]));

    expect(engine.getEdgeGeometry().get('a-b')!.to).toEqual({ x: 137, y: 42 });
  });

  it('needs both halves of a point before it treats an end as loose', async () => {
    const engine = await threeNodeEngine();
    const before = engine.getEdgeGeometry().get('a-b')!.to;

    engine.setEdgeOverlay(new Map([['a-b', { targetX: 137 }]]));

    expect(engine.getEdgeGeometry().get('a-b')!.to).toEqual(before);
  });

  it('honours an overlaid source as well as a target', async () => {
    const engine = await threeNodeEngine();
    const before = engine.getEdgeGeometry().get('a-b')!.from.x;

    engine.setEdgeOverlay(new Map([['a-b', { source: 'c' }]]));

    expect(engine.getEdgeGeometry().get('a-b')!.from.x).toBeGreaterThan(before);
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

/**
 * An optimistic edit has to reach everything a node's data decides, not only the drawing.
 *
 * A card is drawn from its style, *picked* by the spatial index, and its edges are routed to its
 * border — all three resolved from the same rules. Overlay only the drawing and a resized card is
 * clicked at its old size and has arrows pointing at where it used to end, until something else
 * forces a re-read. That is what this pins.
 */
describe('data overlay', () => {
  const cardStyle = [{ style: { shape: 'card' as const, width: { from: 'data.canvasWidth' }, height: 100 } }];

  const twoCards: SeedSource = {
    id: 'two',
    async seed() {
      return {
        nodes: [
          { id: 'a', kind: 'entity' as const, type: 'Card', label: 'A', data: { canvasWidth: 100 } },
          { id: 'b', kind: 'entity' as const, type: 'Card', label: 'B', data: { canvasWidth: 100 } },
        ],
        edges: [{ id: 'a->b', source: 'a', target: 'b', type: 'rel' }],
      };
    },
  };

  async function canvasEngine() {
    const registry = new PluginRegistry({ seeds: [twoCards], expanders: [], layouts });
    const engine = engineWith({ seeds: { source: 'two' }, layout: { type: 'grid' }, nodeStyle: cardStyle }, registry);
    await engine.start();
    return engine;
  }

  it('picks a node at its overlaid size', async () => {
    const engine = await canvasEngine();
    const at = engine.getPositions().get('a')!;
    // 120 world units to the right of centre: outside a 100-wide card, inside a 400-wide one.
    const beyond = { x: at.x + 120, y: at.y };

    expect(engine.index.hitTest(beyond)).not.toContain('a');

    engine.setDataOverlay(new Map([['a', { canvasWidth: 400 }]]));

    expect(engine.index.hitTest(beyond)).toContain('a');
  });

  it('re-routes the edges that meet an overlaid node', async () => {
    const engine = await canvasEngine();
    const before = engine.getEdgeGeometry().get('a->b');

    engine.setDataOverlay(new Map([['b', { canvasWidth: 400 }]]));

    // The line stops short of the node's border, so a wider target ends the edge sooner.
    expect(engine.getEdgeGeometry().get('a->b')?.to).not.toEqual(before?.to);
  });

  it('leaves the node the seeds returned alone', async () => {
    // The host works out that a write has come back by comparing its patch against the *seeded*
    // data. Merging the overlay into the store would report every patch settled the moment it was
    // applied, and the card would flick back to the old value.
    const engine = await canvasEngine();

    engine.setDataOverlay(new Map([['a', { canvasWidth: 400 }]]));

    expect(engine.store.node('a')?.data?.canvasWidth).toBe(100);
    expect(engine.overlayFor('a')).toEqual({ canvasWidth: 400 });
  });

  it('tells subscribers the graph changed', async () => {
    const engine = await canvasEngine();
    const reasons: string[] = [];
    engine.subscribe((reason) => reasons.push(reason));

    engine.setDataOverlay(new Map([['a', { canvasWidth: 400 }]]));

    expect(reasons).toContain('graph');
  });

  it('clears back to the seeded size', async () => {
    const engine = await canvasEngine();
    engine.setDataOverlay(new Map([['a', { canvasWidth: 400 }]]));

    engine.setDataOverlay(new Map());

    expect(engine.hasDataOverlay()).toBe(false);
    const at = engine.getPositions().get('a')!;
    expect(engine.index.hitTest({ x: at.x + 120, y: at.y })).not.toContain('a');
  });
});

/**
 * The connect gesture's preview is the edge it is proposing.
 *
 * It was two raw points drawn as a straight segment, so the line changed shape at the exact moment
 * of commitment: a straight line became an S-curve leaving a different side of the card, at the one
 * instant somebody is deciding whether the gesture did what they meant. Routed through the same
 * `routeEdge` a real edge goes through, there is nothing left to change.
 *
 * Not in the store, still: nothing here lays it out, hit-tests it or counts it against a budget.
 */
describe('the pending connection', () => {
  async function connecting(spec?: { edgeStyle?: unknown }) {
    const registry = new PluginRegistry({ seeds: [seedOf(1)], expanders: [fanoutExpander(0)], layouts });
    const engine = engineWith(
      { seeds: { source: 'test' }, layout: { type: 'grid' }, expansion: { defaultDepth: 0 }, ...spec } as Parameters<
        typeof GraphEngine.prototype.setSpec
      >[0],
      registry,
    );
    await engine.start();
    return engine;
  }

  /**
   * Two seeds, so there is something to land on, and far enough apart to mean it.
   *
   * The shared `grid` stub spaces nodes ten apart, which is inside their own clearance — every
   * attachment then lands behind the node it belongs to, and an assertion that the endpoint moved
   * off the centre passes on nonsense. Its own layout rather than a wider shared one, so no other
   * test's positions move.
   */
  async function connectingTwo() {
    const spread = {
      grid: () => ({
        id: 'grid',
        init(input: { nodes: { id: string }[] }) {
          return { positions: new Map(input.nodes.map((node, index) => [node.id, { x: index * 400, y: 0 }])) };
        },
      }),
    };
    const registry = new PluginRegistry({ seeds: [seedOf(2)], expanders: [fanoutExpander(0)], layouts: spread });
    const engine = engineWith(
      { seeds: { source: 'test' }, layout: { type: 'grid' }, expansion: { defaultDepth: 0 } },
      registry,
    );
    await engine.start();
    return engine;
  }

  it('is nothing at all until a gesture is running', async () => {
    const engine = await connecting();

    expect(engine.getPendingConnection()).toBeNull();
  });

  it('starts on the source rather than under it', async () => {
    // The reported symptom: the line came out of the middle of the card it was dragged from, because
    // the source's own clearance was never applied. `seed-0` is at the origin under the grid layout.
    const engine = await connecting();
    engine.behaviourContext().drawConnection('seed-0', { x: 400, y: 0 });

    const route = engine.getPendingConnection()!;

    expect(route.from.x).toBeGreaterThan(0);
    expect(route.from.x).toBeLessThan(400);
  });

  it('ends exactly at the pointer over empty canvas, which is not a node', async () => {
    // The asymmetry that is deliberate: there is no shape at the far end to stop short of, so a
    // target clearance there would leave the arrowhead hanging a node's width from the cursor.
    const engine = await connecting();
    engine.behaviourContext().drawConnection('seed-0', { x: 400, y: 120 });

    expect(engine.getPendingConnection()!.to).toEqual({ x: 400, y: 120 });
  });

  it('ends on a card it is over, not at the point inside it', async () => {
    /*
      The far end stops being the pointer once the drag is over something it could connect to, and
      becomes the target's own edge — exactly what a real edge does, so what is drawn and what lands
      are the same. Without it the arrowhead sat wherever the cursor was, which for anyone aiming at
      a card is somewhere in its middle.

      `seed-0` sits at the origin and `seed-1` well to its right, so the pointer is put on the second
      one's centre — the worst case, and the one somebody aiming at a card actually produces.
    */
    const engine = await connectingTwo();
    const landing = engine.getPositions().get('seed-1')!;
    engine.behaviourContext().drawConnection('seed-0', { x: landing.x, y: landing.y });

    const route = engine.getPendingConnection()!;

    // Short of the centre it was given, and still beyond the source: on the near side of the card,
    // which is where the arrowhead belongs. Approaching horizontally, it keeps the target's own y.
    expect(route.to.x).toBeLessThan(landing.x);
    expect(route.to.x).toBeGreaterThan(route.from.x);
    expect(route.to.y).toBe(landing.y);
  });

  it('follows the pointer again over the card it came from', async () => {
    // Dragging out of an edge and back is how the gesture is cancelled by hand, so there is nothing
    // to snap to — `connectionTarget` refuses the source, and the same refusal decides the drop.
    const engine = await connectingTwo();
    const source = engine.getPositions().get('seed-0')!;

    engine.behaviourContext().drawConnection('seed-0', { x: source.x, y: source.y });

    expect(engine.getPendingConnection()!.to).toEqual({ x: source.x, y: source.y });
  });

  it('is drawn with the shape the graph draws its edges with', async () => {
    // What stops it changing shape on the drop. A rule with no `when` applies to the placeholder the
    // style is resolved against, which is the right answer: what an edge with nothing said about it
    // yet would look like.
    const engine = await connecting({ edgeStyle: [{ style: { curve: 'step' } }] });
    engine.behaviourContext().drawConnection('seed-0', { x: 400, y: 120 });

    const route = engine.getPendingConnection()!;

    expect(route.curve).toBe('step');
    expect(route.elbows).toBeDefined();
  });

  it('goes away when the gesture does', async () => {
    const engine = await connecting();
    engine.behaviourContext().drawConnection('seed-0', { x: 400, y: 0 });

    engine.behaviourContext().drawConnection(null);

    expect(engine.getPendingConnection()).toBeNull();
  });
});

/**
 * Opening an edge's route for editing, and what that does to the node selection.
 *
 * The two are alternatives rather than layers: a canvas showing a selected card's connect dots *and*
 * a selected line's waypoint grips at once is two sets of handles a few pixels apart, with a press
 * that could plausibly mean either.
 */
describe('selecting an edge', () => {
  async function canvas() {
    const registry = new PluginRegistry({ seeds: [seedOf(2)], expanders: [fanoutExpander(0)], layouts });
    const engine = engineWith(
      { seeds: { source: 'test' }, layout: { type: 'grid' }, expansion: { defaultDepth: 0 } },
      registry,
    );
    await engine.start();
    return engine;
  }

  it('opens one route and closes it again', async () => {
    const engine = await canvas();

    engine.selectEdge('some-edge');
    expect(engine.getSelectedEdge()).toBe('some-edge');

    engine.selectEdge(null);
    expect(engine.getSelectedEdge()).toBeNull();
  });

  it('closes an open route when a node is selected', async () => {
    const engine = await canvas();
    engine.selectEdge('some-edge');

    engine.select(['seed-0']);

    expect(engine.getSelectedEdge()).toBeNull();
  });

  it('closes it on a background click, which selects nothing', async () => {
    // `select([])` is what a click on empty canvas does, and "nothing is selected" has to include
    // the line — otherwise its grips outlive the click that was meant to put them away.
    const engine = await canvas();
    engine.selectEdge('some-edge');

    engine.select([]);

    expect(engine.getSelectedEdge()).toBeNull();
  });

  it('clears a selected card', async () => {
    const engine = await canvas();
    engine.select(['seed-0']);

    engine.selectEdge('some-edge');

    expect(engine.getSelection()).toEqual([]);
  });

  it('says nothing about nodes when no node was selected', async () => {
    /*
      The bug this exists for. `selectionChange` means "these nodes are selected now", and firing it
      because an *edge* was clicked says something untrue: a host reading an empty list as "nothing
      is selected, clear the panel" is right to, and would be acting on a change that never
      happened. The workshop canvas does exactly that, which is how it was found.
    */
    const events: string[] = [];
    const registry = new PluginRegistry({ seeds: [seedOf(2)], expanders: [fanoutExpander(0)], layouts });
    const engine = new GraphEngine({
      spec: { seeds: { source: 'test' }, layout: { type: 'grid' }, expansion: { defaultDepth: 0 } },
      registry,
      context,
      onEvent: (event) => events.push(event.type),
    });
    await engine.start();
    events.length = 0;

    engine.selectEdge('some-edge');

    expect(events).not.toContain('selectionChange');
  });

  it('does say so when a card really was deselected by it', async () => {
    const events: { type: string; ids?: string[] }[] = [];
    const registry = new PluginRegistry({ seeds: [seedOf(2)], expanders: [fanoutExpander(0)], layouts });
    const engine = new GraphEngine({
      spec: { seeds: { source: 'test' }, layout: { type: 'grid' }, expansion: { defaultDepth: 0 } },
      registry,
      context,
      onEvent: (event) => events.push(event as { type: string; ids?: string[] }),
    });
    await engine.start();
    engine.select(['seed-0']);
    events.length = 0;

    engine.selectEdge('some-edge');

    expect(events).toEqual([{ type: 'selectionChange', ids: [] }]);
  });
});

describe('restarting the same graph keeps the arrangement', () => {
  it('keeps positions, pins and the selection when the seeds return the nodes on screen', async () => {
    /*
      A spec change restarts the graph, and a restart reset everything before reading the seeds —
      so a canvas whose pending list moved as a pass settled restarted every few seconds, every
      card snapped back, and a card being dragged fell out of the hand holding it. What decides is
      what the seeds return: the same nodes is the same graph with newer data, which is a refresh.
    */
    const seed = mutableSeed(['seed-0', 'seed-1']);
    const registry = new PluginRegistry({ seeds: [seed], layouts });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'grid' } }, registry);
    await engine.start();
    engine.resize(800, 600);
    engine.pin('seed-0', { x: 123, y: 456 });
    engine.select(['seed-1']);

    seed.rows.push('seed-2');
    await engine.start();

    expect(engine.store.nodeCount).toBe(3);
    expect(engine.getPositions().get('seed-0')).toMatchObject({ x: 123, y: 456 });
    expect(engine.isPinned('seed-0')).toBe(true);
    expect(engine.getSelection()).toEqual(['seed-1']);
  });

  it('drops a data key the seeds stopped writing', async () => {
    /*
      The canvas seed writes `pending: true` only while a card is a suggestion. Accepting one
      restarted the graph with the key absent, the restart merged into the node on screen, and the
      old `true` survived — the card stayed faded until the graph was remounted.
    */
    let pending = true;
    const seed: SeedSource = {
      id: 'test',
      async seed() {
        return {
          nodes: [
            {
              id: 'card',
              kind: 'entity' as const,
              type: 'Thing',
              label: 'card',
              data: (pending ? { pending: true } : {}) as Record<string, GraphValue>,
            },
          ],
          edges: [],
        };
      },
    };
    const registry = new PluginRegistry({ seeds: [seed], layouts });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'grid' } }, registry);
    await engine.start();
    expect(engine.store.node('card')?.data).toEqual({ pending: true });

    pending = false;
    await engine.start();
    expect(engine.store.node('card')?.data).toEqual({});

    pending = true;
    await engine.refresh();
    pending = false;
    await engine.refresh();
    expect(engine.store.node('card')?.data?.pending).toBeUndefined();
  });

  it('starts clean when the seeds return a different graph', async () => {
    const seed = mutableSeed(['seed-0', 'seed-1']);
    const registry = new PluginRegistry({ seeds: [seed], layouts });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'grid' } }, registry);
    await engine.start();
    engine.resize(800, 600);
    engine.pin('seed-0', { x: 123, y: 456 });

    seed.rows = ['other-0', 'other-1'];
    await engine.start();

    expect(engine.store.hasNode('seed-0')).toBe(false);
    expect(engine.store.nodeCount).toBe(2);
    expect(engine.isPinned('seed-0')).toBe(false);
  });
});

/**
 * Folding, at the engine level.
 *
 * The unit tests in `fold.test.ts` decide *what* a fold hides; these decide what the scene does about
 * it — that hidden means unplaced, unrouted and unhittable all at once, that unfolding puts a card
 * back where it was rather than wherever a layout would now put it, and that a live canvas cannot
 * leak a fold's contents back onto the screen the next time its data changes.
 */
describe('GraphEngine folding', () => {
  /** `chain` → `branch` → `leaf`, plus a `loose` card connected to nothing. */
  function chainSeed(): SeedSource {
    const ids = ['chain', 'branch', 'leaf', 'loose'];
    return {
      id: 'test',
      async seed() {
        return {
          nodes: ids.map((id) => ({ id, kind: 'entity' as const, type: 'Thing', label: id })),
          edges: [
            { id: 'chain->branch', source: 'chain', target: 'branch', type: 'rel' },
            { id: 'branch->leaf', source: 'branch', target: 'leaf', type: 'rel' },
          ],
        };
      },
    };
  }

  /** `parent` → `shared` ← `other`, plus `parent` → `own`: one card a fold may take, one it may not. */
  function sharedSeed(): SeedSource {
    const ids = ['parent', 'other', 'shared', 'own'];
    return {
      id: 'test',
      async seed() {
        return {
          nodes: ids.map((id) => ({ id, kind: 'entity' as const, type: 'Thing', label: id })),
          edges: [
            { id: 'parent->shared', source: 'parent', target: 'shared', type: 'rel' },
            { id: 'other->shared', source: 'other', target: 'shared', type: 'rel' },
            { id: 'parent->own', source: 'parent', target: 'own', type: 'rel' },
          ],
        };
      },
    };
  }

  async function folded() {
    const registry = new PluginRegistry({ seeds: [chainSeed()], layouts });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'grid' } }, registry);
    await engine.start();
    return engine;
  }

  it('takes the position off everything under the fold, and leaves the card itself placed', async () => {
    const engine = await folded();

    // Instantly: an animated fold is tested below, and every other case here is about the state it
    // settles in rather than the travel.
    engine.setFolded(['chain'], 0);

    expect(engine.getPositions().has('chain')).toBe(true);
    expect(engine.getPositions().has('branch')).toBe(false);
    expect(engine.getPositions().has('leaf')).toBe(false);
    expect(engine.getPositions().has('loose')).toBe(true);
  });

  it('leaves the cards in the store, so nothing has to be re-queried to unfold', async () => {
    const engine = await folded();

    engine.setFolded(['chain'], 0);

    expect(engine.store.hasNode('branch')).toBe(true);
  });

  it('drops the lines that reached what it hid', async () => {
    const engine = await folded();
    expect(engine.getEdgeGeometry().has('chain->branch')).toBe(true);

    engine.setFolded(['chain'], 0);

    expect(engine.getEdgeGeometry().has('chain->branch')).toBe(false);
    expect(engine.getEdgeGeometry().has('branch->leaf')).toBe(false);
  });

  it('stops a hidden card being picked', async () => {
    const engine = await folded();
    const at = engine.getPositions().get('branch')!;
    expect(engine.index.hitTest({ x: at.x, y: at.y })).toContain('branch');

    engine.setFolded(['chain'], 0);

    expect(engine.index.hitTest({ x: at.x, y: at.y })).not.toContain('branch');
  });

  it('clears a selection nobody can see any more', async () => {
    const engine = await folded();
    engine.select(['branch']);

    engine.setFolded(['chain'], 0);

    expect(engine.getSelection()).not.toContain('branch');
  });

  it('puts a card back exactly where it was', async () => {
    const engine = await folded();
    const before = engine.getPositions().get('branch')!;

    engine.setFolded(['chain'], 0);
    engine.setFolded([], 0);

    expect(engine.getPositions().get('branch')).toEqual(before);
    expect(engine.getEdgeGeometry().has('chain->branch')).toBe(true);
  });

  it('holds the fold across a refresh', async () => {
    const engine = await folded();
    engine.setFolded(['chain'], 0);

    // The case a live canvas makes constantly: new data arrives and the graph is re-read.
    await engine.refresh();

    expect(engine.getPositions().has('branch')).toBe(false);
    expect(engine.foldedCount('chain')).toBe(2);
  });

  it('counts what it is holding', async () => {
    const engine = await folded();

    engine.setFolded(['chain'], 0);

    expect(engine.foldedCount('chain')).toBe(2);
    expect(engine.isFolded('chain')).toBe(true);
    expect(engine.foldedCount('loose')).toBe(0);
  });

  it('says how much a fold would have to leave behind', async () => {
    /*
      The rule a fold lives by is invisible without this number. A card another card still points at
      is never taken — it would be left with a line running to nothing — so folding something with
      two things under it can take one, and the one that stayed reads as a fold that half worked.
    */
    const registry = new PluginRegistry({ seeds: [sharedSeed()], layouts });
    const engine = engineWith({ seeds: { source: 'test' }, layout: { type: 'grid' } }, registry);
    await engine.start();

    expect(engine.foldImpact('parent')).toBe(1);
    expect(engine.foldHeldElsewhere('parent')).toBe(1);
    // And the other parent's side of the same fact: it holds the shared card and nothing else.
    expect(engine.foldImpact('other')).toBe(0);
    expect(engine.foldHeldElsewhere('other')).toBe(1);
  });

  it('counts nothing held where nothing is shared', async () => {
    const engine = await folded();

    expect(engine.foldHeldElsewhere('chain')).toBe(0);
    expect(engine.foldHeldElsewhere('leaf')).toBe(0);
  });

  it('offers a fold where one would do something, and not on a leaf', async () => {
    const engine = await folded();

    expect(engine.canFold('chain')).toBe(true);
    expect(engine.canFold('leaf')).toBe(false);
    expect(engine.canFold('loose')).toBe(false);
  });

  it('keeps offering it on the folded card, which is what unfolds it', async () => {
    const engine = await folded();

    engine.setFolded(['chain'], 0);

    expect(engine.canFold('chain')).toBe(true);
  });

  it('brings the contents back beside the fold, not to where they were before it moved', async () => {
    /*
      The two-jump bug. A canvas reads each card's coordinates from its stored placement, and a fold
      carried across the canvas writes new placements for its contents — which take a round trip and
      a re-read to arrive. Unfolding in that window sent every card back to where it was before the
      fold moved, and then the re-read landed and moved them all again. The offset is what the drag
      wrote and what the placement will say, so it is where the card goes.
    */
    const engine = await folded();
    const chain = engine.getPositions().get('chain')!;
    const branch = engine.getPositions().get('branch')!;
    engine.setFolded(['chain'], 0);
    engine.pin('chain', { x: chain.x + 300, y: chain.y + 120 });

    engine.setFolded([], 0);

    expect(engine.getPositions().get('branch')).toMatchObject({ x: branch.x + 300, y: branch.y + 120 });
  });

  it('travels back to the same place, rather than animating to the wrong one', async () => {
    // The same fix on the animated path, where it decides where the travel *ends*.
    vi.useFakeTimers();
    try {
      const engine = await folded();
      const chain = engine.getPositions().get('chain')!;
      const branch = engine.getPositions().get('branch')!;
      engine.setFolded(['chain'], 200);
      vi.advanceTimersByTime(300);
      engine.pin('chain', { x: chain.x + 300, y: chain.y + 120 });

      engine.setFolded([], 200);
      vi.advanceTimersByTime(300);

      expect(engine.getPositions().get('branch')).toMatchObject({ x: branch.x + 300, y: branch.y + 120 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('carries what it is holding, wherever the fold has got to', async () => {
    const engine = await folded();
    const chain = engine.getPositions().get('chain')!;
    const branch = engine.getPositions().get('branch')!;
    engine.setFolded(['chain'], 0);

    // Where the contents are is answered against where the fold is *now*, so a fold that has not
    // moved reports its contents exactly where they were.
    expect(engine.foldedUnder('chain').find((row) => row.id === 'branch')).toEqual({
      id: 'branch',
      x: branch.x,
      y: branch.y,
    });

    engine.pin('chain', { x: chain.x + 50, y: chain.y - 20 });
    const carried = engine.foldedUnder('chain');

    expect(carried).toHaveLength(2);
    expect(carried.find((row) => row.id === 'branch')).toEqual({
      id: 'branch',
      x: branch.x + 50,
      y: branch.y - 20,
    });
    // Idempotent: asking twice is the same answer, so a drag that reports twice cannot double it.
    expect(engine.foldedUnder('chain')).toEqual(carried);
  });

  it('carries what it is holding after an animated fold, not only an instant one', async () => {
    /*
      The path every real fold takes. A travelling card's position is deleted when the travel ends,
      which does not go through the place the offsets are measured — so measuring only the instant
      case left the ordinary one carrying nothing, silently, and only when somebody dragged a fold
      they had made a moment earlier.
    */
    vi.useFakeTimers();
    try {
      const engine = await folded();
      const chain = engine.getPositions().get('chain')!;
      const branch = engine.getPositions().get('branch')!;

      engine.setFolded(['chain'], 200);
      vi.advanceTimersByTime(300);
      engine.pin('chain', { x: chain.x + 40, y: chain.y });

      expect(engine.foldedUnder('chain').find((row) => row.id === 'branch')).toEqual({
        id: 'branch',
        x: branch.x + 40,
        y: branch.y,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('travels, and is gone once it arrives', async () => {
    vi.useFakeTimers();
    try {
      const engine = await folded();
      const chain = engine.getPositions().get('chain')!;

      engine.setFolded(['chain'], 200);

      // Still drawn, at full size, exactly where it was: the first frame of a fold has to leave
      // everything alone, or the card jumps before it travels.
      expect(engine.getPositions().has('branch')).toBe(true);
      expect(engine.foldScale('branch')).toBe(1);

      vi.advanceTimersByTime(100);
      expect(engine.foldScale('branch')).toBeLessThan(1);
      const midway = engine.getPositions().get('branch')!;
      // Travelling towards the card that swallowed it.
      expect(Math.abs(midway.x - chain.x)).toBeLessThan(Math.abs(engine.getPositions().get('loose')!.x - chain.x));

      vi.advanceTimersByTime(200);
      expect(engine.getPositions().has('branch')).toBe(false);
      expect(engine.foldScale('branch')).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
