/**
 * Where a held card would land, drawn two ways: as a destination, or as its own place.
 *
 * Reported: the ghost for "back where it was" looked exactly like the ghost for a new place, so ending a drag
 * without changing anything meant remembering where the card had come from. Its own place is now a hole —
 * no accent, no dashes, no line — and the card in the hand dims with it.
 */
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import { GraphView } from './GraphView.solid';

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

const node = (id: string, rank: number) => ({ id, kind: 'entity' as const, type: 'Thing', label: id, data: { rank } });

/** A parent over two children, laid out as a forest, with the arranging gesture and nothing else. */
async function mountTree() {
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(
    () => (
      <GraphView
        seeds={{
          literal: true,
          nodes: [node('p', 0), node('a', 0), node('b', 1)],
          edges: [
            { id: 'p-a', source: 'p', target: 'a', type: 'rel' },
            { id: 'p-b', source: 'p', target: 'b', type: 'rel' },
          ],
        }}
        layout={{
          type: 'forest',
          options: { card: { width: 100, height: 100 }, siblingGap: 20, levelGap: 50, sortBy: 'rank' },
        }}
        nodeStyle={[{ style: { shape: 'card', width: 100, height: 100 } }] as never}
        behaviours={['arrange-nodes']}
      />
    ),
    host,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));

  const surface = host.querySelector('.we-graph__surface') as HTMLElement;
  /** A pointer event at a world point — the camera is untouched, so world and screen are one here. */
  const pointer = (type: string, x: number, y: number, buttons = 1) =>
    surface.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, buttons, pointerId: 1 }));
  const ghost = () => host.querySelector('.we-graph__ghost');
  const line = () => ghost()?.querySelector('path:not(.we-graph__ghost-outline)') ?? null;
  const heldIdle = () => host.querySelector('.we-graph__node--held-idle');
  return { pointer, ghost, line, heldIdle };
}

describe('the ghost of a held card', () => {
  it('is a hole with no line over the card’s own place, and a destination with its line elsewhere', async () => {
    const { pointer, ghost, line, heldIdle } = await mountTree();
    // The forest puts a and b side by side at x 50 and 170, one level (y 150) under p.
    pointer('pointerdown', 170, 150);
    pointer('pointermove', 175, 150);

    expect(ghost()?.classList.contains('we-graph__ghost--home')).toBe(true);
    expect(line()).toBeNull();
    expect(heldIdle()).not.toBeNull();

    // Past a's middle: b would go first.
    pointer('pointermove', 20, 150);
    expect(ghost()?.classList.contains('we-graph__ghost--home')).toBe(false);
    expect(line()).not.toBeNull();
    expect(heldIdle()).toBeNull();
  });
});
