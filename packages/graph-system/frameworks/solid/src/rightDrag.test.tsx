/**
 * A right-drag from a card draws a connection — so the browser's own menu has to stay off the card, and
 * only there, and only where the graph has been told a right-drag means something.
 */
import { entityAddress } from '@we/graph-protocol';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import { GraphView } from './GraphView.solid';

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

async function mounted(behaviours: unknown[]) {
  const el = document.createElement('div');
  document.body.append(el);
  dispose = render(
    () => (
      <GraphView
        seeds={{
          literal: true,
          nodes: [
            {
              id: entityAddress('ds', 'Card', 'a'),
              kind: 'entity',
              type: 'Card',
              label: 'a',
              data: { x: 100, y: 100 },
            },
          ],
          edges: [],
        }}
        layout={{ type: 'manual' }}
        nodeStyle={[{ style: { shape: 'card', width: 120, height: 80 } }] as never}
        behaviours={behaviours as never}
      />
    ),
    el,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  const surface = el.querySelector('.we-graph__surface') as HTMLElement;
  /** Whether a right-click at this point kept the browser's menu. */
  return (x: number, y: number) =>
    surface.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }),
    );
}

describe('a right-drag to connect', () => {
  it('keeps the browser menu off a card, and on the canvas around it', async () => {
    const menuAt = await mounted([{ type: 'connect-nodes', options: { button: 'secondary' } }, 'select', 'pan-zoom']);
    expect(menuAt(100, 100)).toBe(false);
    expect(menuAt(700, 500)).toBe(true);
  });

  it('leaves the browser menu alone where a right-drag means nothing', async () => {
    const menuAt = await mounted(['select', 'pan-zoom']);
    expect(menuAt(100, 100)).toBe(true);
  });
});
