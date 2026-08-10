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
