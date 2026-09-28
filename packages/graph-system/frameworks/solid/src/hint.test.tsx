/**
 * A handle's tooltip goes with the handle.
 *
 * Reported as "Drag around the card to pin a side…" stuck at the top of the screen with no way to close
 * it. The hint was raised on `pointerenter` and withdrawn only on `pointerleave` — and a browser fires no
 * `pointerleave` for an element taken out from under the pointer. Handles are taken out constantly: the
 * hovered line changes, a card is deselected, the canvas becomes a tree that offers no anchors. Each of
 * those left a hint with nothing left to leave.
 */
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import { GraphView } from './GraphView.solid';

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

/** One selected card offering connect dots — while `connectable` is on. */
async function mountSelectedCard() {
  const [connectable, setConnectable] = createSignal(true);
  const [bg, setBg] = createSignal('red');
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(
    () => (
      <GraphView
        seeds={{
          literal: true,
          nodes: [{ id: 'card', kind: 'entity', type: 'Thing', label: 'card', data: { x: 100, y: 100 } }],
          edges: [],
        }}
        layout={{ type: 'manual' }}
        nodeStyle={[{ style: { shape: 'card', width: 180, height: 100 } }] as never}
        behaviours={['select', 'pan-zoom']}
        bg={bg()}
        onEdgeCreate={connectable() ? () => {} : undefined}
      />
    ),
    host,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));

  const surface = host.querySelector('.we-graph__surface') as HTMLElement;
  const click = (x: number, y: number) => {
    for (const type of ['pointerdown', 'pointerup']) {
      surface.dispatchEvent(
        new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, buttons: type == 'pointerdown' ? 1 : 0 }),
      );
    }
  };
  click(100, 100);
  const dot = host.querySelector('.we-graph__connect') as HTMLElement | null;
  const tooltip = () => host.querySelector('we-tooltip');
  return { host, dot, tooltip, click, setConnectable, setBg };
}

describe('a handle’s hint', () => {
  it('shows while the pointer is on the handle, and through an unrelated change', async () => {
    const { dot, tooltip, setBg } = await mountSelectedCard();
    expect(dot).not.toBeNull();

    dot!.dispatchEvent(new PointerEvent('pointerenter'));
    expect(tooltip()?.getAttribute('content') ?? (tooltip() as { content?: string })?.content).toBe('Drag to connect');
    setBg('blue');
    expect(tooltip()).not.toBeNull();

    dot!.dispatchEvent(new PointerEvent('pointerleave'));
    expect(tooltip()).toBeNull();
  });

  it('goes when the handle is taken away from under the pointer', async () => {
    const { dot, tooltip, setConnectable } = await mountSelectedCard();
    dot!.dispatchEvent(new PointerEvent('pointerenter'));
    expect(tooltip()).not.toBeNull();

    // No pointerleave: the element is simply removed, which is what a browser does too.
    setConnectable(false);
    expect(tooltip()).toBeNull();
  });

  it('goes when the card it belongs to is deselected', async () => {
    const { host, dot, tooltip, click } = await mountSelectedCard();
    dot!.dispatchEvent(new PointerEvent('pointerenter'));
    expect(tooltip()).not.toBeNull();

    click(900, 700);
    expect(host.querySelector('.we-graph__connect')).toBeNull();
    expect(tooltip()).toBeNull();
  });
});
