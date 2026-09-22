/**
 * A gesture outlives the props around it.
 *
 * The schema renderer hands a component its props through one memo, so a change to any of them
 * re-runs every read of every other. GraphView built its behaviours from one of those reads, and a
 * behaviour is stateful — so on the workshop's canvas a card dragged for a few seconds was let go of
 * the moment something unrelated re-resolved, frozen where it was and never saved.
 *
 * Mounted the way the renderer mounts it, because passing props directly gives each its own getter
 * and cannot reproduce the failure at all.
 */
import { createMemo, createSignal } from 'solid-js';
import { Dynamic, render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import { GraphView } from './GraphView.solid';

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

const BEHAVIOURS = ['select', { type: 'drag-node', options: { pin: true } }, 'pan-zoom'];

/** A one-card canvas whose props arrive as one spread memo, with `bg` and `behaviours` controllable. */
async function mountCanvas() {
  const [bg, setBg] = createSignal('red');
  const [behaviours, setBehaviours] = createSignal<unknown[]>(BEHAVIOURS);
  const ends: { id: string; x: number; y: number }[] = [];

  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => {
    const attrs = createMemo(() => ({
      seeds: {
        literal: true,
        nodes: [{ id: 'card', kind: 'entity', type: 'Thing', label: 'card', data: { x: 100, y: 100 } }],
        edges: [],
      },
      layout: { type: 'manual' },
      nodeStyle: [{ style: { shape: 'card', width: 180, height: 100 } }],
      behaviours: behaviours(),
      bg: bg(),
      onNodeDragEnd: (payload: { id: string; x: number; y: number }) => ends.push(payload),
    }));
    return <Dynamic component={GraphView} {...(attrs() as Parameters<typeof GraphView>[0])} />;
  }, host);

  // The seeds load asynchronously; nothing is hittable until they land.
  await new Promise((resolve) => setTimeout(resolve, 20));

  const surface = host.querySelector('.we-graph__surface') as HTMLElement;
  const pointer = (type: string, x: number, buttons = 1) =>
    surface.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: 100, buttons, pointerId: 1 }));

  return { pointer, setBg, setBehaviours, ends };
}

describe('GraphView gestures', () => {
  it('keeps a drag going when an unrelated prop changes mid-gesture', async () => {
    const { pointer, setBg, ends } = await mountCanvas();

    pointer('pointerdown', 100);
    pointer('pointermove', 150);
    setBg('blue');
    pointer('pointermove', 200);
    pointer('pointerup', 200, 0);

    expect(ends).toEqual([{ id: 'card', x: 200, y: 100 }]);
  });

  it('still takes a genuinely different behaviour list', async () => {
    // The guard compares by value, so a real change must land: without drag-node, a drag moves nothing.
    const { pointer, setBehaviours, ends } = await mountCanvas();

    setBehaviours(['select', 'pan-zoom']);
    pointer('pointerdown', 100);
    pointer('pointermove', 200);
    pointer('pointerup', 200, 0);

    expect(ends).toEqual([]);
  });
});
