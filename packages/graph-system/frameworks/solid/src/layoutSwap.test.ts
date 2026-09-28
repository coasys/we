/**
 * A layout swap moves the camera with it, whichever call carries it out.
 *
 * Freeform → tree sometimes emptied the screen and slid the tree back in from the side. A seed option
 * that changed with the same click re-derived the canvas, and that path set the new spec — layout and
 * all — and laid the graph out synchronously, before the renderer's layout effect had run. It laid out
 * the tree with no fit, so the cards travelled to where the tree goes while the camera stayed on the
 * freeform view; the layout effect fitted a moment later and the camera chased the tree back into view.
 */
import { GraphEngine, PluginRegistry } from '@we/graph-core';
import { forestLayout, manualLayout } from '@we/graph-layouts';
import type { SeedSource } from '@we/graph-protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const TREE = { type: 'forest', options: { card: { width: 180, height: 120 } } };

async function freeformFarFromTheOrigin() {
  const ids = ['p', 'a', 'b', 'q', 'x'];
  const seed: SeedSource = {
    id: 'test',
    async seed() {
      return {
        // Freeform cards well away from where a tree is laid out, so a camera left behind shows nothing.
        nodes: ids.map((id, i) => ({
          id,
          kind: 'entity' as const,
          type: 'Card',
          label: id,
          data: { x: 6000 + i * 300, y: 4000 },
        })),
        edges: [
          { id: 'pa', source: 'p', target: 'a', type: 'rel' },
          { id: 'pb', source: 'p', target: 'b', type: 'rel' },
          { id: 'qx', source: 'q', target: 'x', type: 'rel' },
        ],
      };
    },
  };
  const registry = new PluginRegistry({
    seeds: [seed],
    expanders: [],
    layouts: { manual: manualLayout, forest: forestLayout },
  });
  const engine = new GraphEngine({
    spec: {
      seeds: { source: 'test' },
      layout: { type: 'manual' },
      nodeStyle: [{ style: { shape: 'card', width: 180, height: 120 } }] as never,
    },
    registry,
    context: {} as never,
  });
  engine.resize(1400, 800);
  await engine.start();
  engine.setSelfTravel(420);
  return engine;
}

function visible(engine: GraphEngine): number {
  const { x, y, zoom } = engine.viewport.get();
  let count = 0;
  for (const at of engine.getPositions().values()) {
    const sx = at.x * zoom + x;
    const sy = at.y * zoom + y;
    if (sx > -90 && sx < 1490 && sy > -60 && sy < 860) count += 1;
  }
  return count;
}

describe('a layout swap', () => {
  it('keeps the cards in view when a re-derive carries it out before the layout is asked for', async () => {
    const engine = await freeformFarFromTheOrigin();
    expect(visible(engine)).toBe(5);

    // What the derive effect does: the new spec, layout included, then a re-derive — no fit asked for.
    engine.setSpec({ seeds: { source: 'test' }, layout: TREE as never });
    await engine.rederive();
    let least = visible(engine);
    for (let t = 0; t < 800; t += 16) {
      await vi.advanceTimersByTimeAsync(16);
      least = Math.min(least, visible(engine));
    }
    // Never an empty screen on the way, and the tree framed at the end.
    expect(least).toBeGreaterThanOrEqual(4);
    expect(visible(engine)).toBe(5);
  });
});
