/**
 * Headless render benchmark for the schema system.
 *
 * WHY THIS PACKAGE EXISTS
 *
 * Iterating against the in-app suite (SchemaBenchmark.schema.ts) means edit → rebuild → reload →
 * run 12 routes three times → read results. That loop is slow enough to encourage guessing, and
 * guessing already cost a 2.5x Build regression that reached the app before being caught.
 *
 * It lives in its own package rather than in @we/schema-solid because measuring the real cost needs
 * the real design system, and @we/schema-solid must not depend on it — the renderer is a thin
 * adapter over an *injected* registry, and knowing nothing about the DS is what keeps it portable.
 * Nothing depends on this package, so it is free to depend on both.
 *
 * WHY BOTH REGISTRIES
 *
 * The same fixtures are rendered twice: once through stub components, once through the real ones.
 *
 *   stub  — the schema walk in isolation
 *   real  — the walk plus everything it causes downstream (buildLayoutStyles, Lit reactive-property
 *           setters, the ~59 CSSOM writes per DS element)
 *
 * The gap between them is the point. A change that consolidated per-prop memos measured +6% against
 * stubs and +160% in the real app, because the cost lived entirely in what the per-prop effects then
 * did. A stub-only harness is structurally blind to that whole class of change — which is the class
 * most renderer optimisations fall into.
 *
 * SCOPE
 *
 *   Build   ✅  schema walk, prop resolution, reactive allocation, DOM creation
 *   Flush   ✅  Lit's async first render + DS prop pipeline (drained via updateComplete)
 *   Paint   ✗   happy-dom has no layout engine
 *
 * Paint is ~30% of total in the real suite, so this is not a replacement for it. Treat a result
 * here as a filter: a regression means stop, a win is a hypothesis to confirm in the app on a
 * settled run 3.
 *
 * Note Lit runs in dev mode here, as it does in the app's dev server — absolute numbers are not
 * production figures, but comparisons between two versions of the renderer are valid.
 *
 * Run: pnpm --filter @we/schema-bench bench
 */
// Side-effect import: defines we-text, we-button and the rest as custom elements.
import '@we/primitives';

import { Column, Row } from '@we/components/solid';
import type { SchemaNode } from '@we/schema-shared';
import type { ComponentRegistry } from '@we/schema-solid';
import { RenderSchema } from '@we/schema-solid';
import type { JSX } from 'solid-js';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import { describe, expect, it } from 'vitest';

/** Discarded — the first builds pay one-time JIT and Lit template compilation. */
const WARMUP = 2;
const SAMPLES = 5;

/** Renderer in isolation: no style computation, no custom elements. */
const Passthrough = (props: { children?: JSX.Element }) => <div>{props.children}</div>;
const STUB_REGISTRY: ComponentRegistry = { Column: Passthrough, Row: Passthrough };

/** The real thing — same components the app renders through. */
const REAL_REGISTRY: ComponentRegistry = { Column, Row };

const stores = {
  testStore: { stringValue: 'hello', numberValue: 42, boolTrue: true, boolFalse: false },
};

/** Mirrors staticCard in SchemaBenchmark.schema.ts: 1 Column + 3 we-text, all-static props. */
function staticCard(id: number): SchemaNode {
  return {
    type: 'Column',
    props: { p: '300', gap: '200', bg: 'neutral-0', r: '300', border: '1px solid neutral-200' },
    children: [
      { type: 'we-text', props: { text: `Card ${id}`, fontSize: '400', fontWeight: '600', color: 'neutral-800' } },
      { type: 'we-text', props: { text: `Description ${id}`, fontSize: '300', color: 'neutral-600' } },
      { type: 'we-text', props: { text: `Detail ${id}`, fontSize: '200', color: 'neutral-400' } },
    ],
  };
}

/** Mirrors tokenCard: same shape, but props and children carry $store / $if / $concat tokens. */
function tokenCard(id: number): SchemaNode {
  return {
    type: 'Column',
    props: { p: '300', gap: '200', bg: 'neutral-0', r: '300' },
    children: [
      {
        type: 'we-text',
        props: {
          fontSize: '400',
          color: { $if: { condition: { $store: 'testStore.boolTrue' }, then: 'neutral-600', else: 'danger-600' } },
        },
        children: [{ $concat: ['Card ', { $store: 'testStore.stringValue' }, ` #${id}`] }],
      },
      {
        type: 'we-text',
        props: { fontSize: '300', color: 'neutral-500' },
        children: [{ $concat: ['Count: ', { $store: 'testStore.numberValue' }] }],
      },
    ],
  };
}

function tree(count: number, factory: (id: number) => SchemaNode): SchemaNode {
  return {
    type: 'Column',
    props: { width: '100%', gap: '200' },
    children: Array.from({ length: count }, (_, i) => factory(i + 1)),
  };
}

type Sample = { build: number; flush: number };

/** Lit exposes `updateComplete` on upgraded elements; plain DOM nodes don't. */
type MaybeLitElement = Element & { updateComplete?: Promise<unknown> };

/** One full render. Build is the synchronous walk; flush drains Lit's async first render. */
async function timeRender(node: SchemaNode, registry: ComponentRegistry): Promise<Sample> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const [schema] = createStore(node);

  const t0 = performance.now();
  const dispose = render(() => <RenderSchema node={schema} stores={stores} registry={registry} />, container);
  const built = performance.now();

  // Collect first, then time the await — walking 8000 elements to find pending updates is itself
  // significant work and would otherwise be charged to flush.
  const pending = Array.from(container.querySelectorAll('*'))
    .map((el) => (el as MaybeLitElement).updateComplete)
    .filter(Boolean);
  const collected = performance.now();
  await Promise.all(pending);
  const flushed = performance.now();

  dispose();
  container.remove();
  return { build: built - t0, flush: flushed - collected };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

async function measure(node: SchemaNode, registry: ComponentRegistry): Promise<Sample> {
  for (let i = 0; i < WARMUP; i++) await timeRender(node, registry);
  const samples: Sample[] = [];
  for (let i = 0; i < SAMPLES; i++) samples.push(await timeRender(node, registry));
  return {
    build: median(samples.map((s) => s.build)),
    flush: median(samples.map((s) => s.flush)),
  };
}

async function compare(label: string, node: SchemaNode) {
  const stub = await measure(node, STUB_REGISTRY);
  const real = await measure(node, REAL_REGISTRY);
  const amplification = stub.build > 0 ? (real.build + real.flush) / stub.build : 0;

  console.log(
    `${label.padEnd(30)}` +
      `stub build ${stub.build.toFixed(1).padStart(7)}ms  |  ` +
      `real build ${real.build.toFixed(1).padStart(7)}ms  flush ${real.flush.toFixed(1).padStart(7)}ms  ` +
      `(${amplification.toFixed(1)}x stub)`,
  );
}

describe('schema render (headless)', () => {
  it('static trees', async () => {
    await compare('static 50 (200 nodes)', tree(50, staticCard));
    await compare('static 200 (800 nodes)', tree(200, staticCard));
    await compare('static 1000 (4000 nodes)', tree(1000, staticCard));
    expect(true).toBe(true);
  });

  it('token trees', async () => {
    await compare('token 50 (150 nodes)', tree(50, tokenCard));
    await compare('token 200 (600 nodes)', tree(200, tokenCard));
    expect(true).toBe(true);
  });
});
