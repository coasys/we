/**
 * Headless timing benchmarks — the fast filter for renderer changes.
 *
 * `pnpm --filter @we/playground-render-bench bench`
 *
 * WHY BOTH THIS AND THE BROWSER HARNESS
 *
 * Iterating against a browser means edit → rebuild → reload → run → read. That loop is slow enough
 * to encourage guessing, and guessing has already put a 2.5x Build regression into the app before
 * it was caught. This runs in seconds.
 *
 * SCOPE — Build and Flush only. happy-dom has no layout engine, so Paint is invisible, and its JS
 * CSSOM implementation overstates Flush by roughly 2.7x versus a real browser. A change that looked
 * like +6% here measured +160% in the app, because the cost lived in what the per-prop effects then
 * did rather than in the walk itself.
 *
 * So: **a regression here means stop; a win here is only a hypothesis.** Confirm in the browser
 * harness before believing a number, and never publish figures from this file.
 *
 * Deliberately excluded from CI (`vitest.bench.config.ts`, not `vitest.config.ts`) — benchmarks on
 * shared runners are noise and must not decide whether a merge is allowed. The correctness tests in
 * `tests/` do run there.
 */
import '@we/primitives';

import type { SchemaNode } from '@we/schema-shared';
import type { ComponentRegistry } from '@we/schema-solid';
import { RenderSchema } from '@we/schema-solid';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import { describe, expect, it } from 'vitest';

import { benchStore, cardGrid, staticCard, tokenCard, wcCard } from '../src/fixtures';
import { registry, stubRegistry } from '../src/registry';

const WARMUP = 2;
const SAMPLES = 5;

const stores = { benchStore };

type Sample = { build: number; flush: number };
type MaybeLitElement = Element & { updateComplete?: Promise<unknown> };

/** One render. Build is the synchronous walk; flush drains Lit's async first render. */
async function timeRender(node: SchemaNode, reg: ComponentRegistry): Promise<Sample> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  // Wrapped in a store because the real renderer reads `node.props`/`node.children` through a store
  // proxy, and the proxy traps are a real part of the cost. Plain objects would understate it.
  const [schema] = createStore(node);

  const t0 = performance.now();
  const dispose = render(() => <RenderSchema node={schema} stores={stores} registry={reg} />, container);
  const built = performance.now();

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

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)];

async function measure(node: SchemaNode, reg: ComponentRegistry): Promise<Sample> {
  for (let i = 0; i < WARMUP; i++) await timeRender(node, reg);
  const samples: Sample[] = [];
  for (let i = 0; i < SAMPLES; i++) samples.push(await timeRender(node, reg));
  return { build: median(samples.map((s) => s.build)), flush: median(samples.map((s) => s.flush)) };
}

/**
 * Reports both registries. The stub isolates the schema walk; the real one adds everything the walk
 * causes downstream (`buildLayoutStyles`, Lit reactive-property setters, the CSSOM writes). The gap
 * between them is the point — a stub-only harness is blind to the class of change most renderer
 * optimisations fall into.
 */
async function compare(label: string, node: SchemaNode) {
  const stub = await measure(node, stubRegistry);
  const real = await measure(node, registry);
  console.log(
    `${label.padEnd(28)}` +
      `stub build ${stub.build.toFixed(1).padStart(7)}ms  |  ` +
      `real build ${real.build.toFixed(1).padStart(7)}ms  flush ${real.flush.toFixed(1).padStart(7)}ms`,
  );
}

describe('headless render timings', () => {
  it('static trees', async () => {
    await compare('static 50 (200 nodes)', cardGrid(50, staticCard, '200px', '8px'));
    await compare('static 200 (800 nodes)', cardGrid(200, staticCard, '180px', '8px'));
    await compare('static 1000 (4000 nodes)', cardGrid(1000, staticCard, '180px', '8px'));
    expect(true).toBe(true);
  });

  it('token trees', async () => {
    await compare('token 50 (150 nodes)', cardGrid(50, tokenCard, '200px', '8px'));
    await compare('token 200 (600 nodes)', cardGrid(200, tokenCard, '200px', '8px'));
    expect(true).toBe(true);
  });

  it('the ladder fixture', async () => {
    await compare('wc 100 (300 nodes)', cardGrid(100, wcCard));
    expect(true).toBe(true);
  });
});
