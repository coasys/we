/**
 * What an arrange drop tells the template about the card it moved.
 *
 * The engine reports a drop as a `nodeArrange` event carrying the node; what `onNodeArrange` hands
 * back out is a record payload — the id and type parsed out of the address, and the marks the seed
 * left on the card's data. `pending` and `changed` are the ones a consumer can refuse a write on:
 * a drop rewrites the dragged record's own field, and a card still awaiting acceptance or carrying
 * a staged change has no settled state to write from or an undo to return to.
 *
 * Mounted rather than engine-level because the translation is the renderer's — the engine's event
 * carries the node untouched, and only this file decides which of its fields reach the template.
 */
import { entityAddress } from '@we/graph-protocol';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import { GraphView } from './GraphView.solid';
import type { GraphViewProps } from './GraphView.types';

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

const addr = (id: string) => entityAddress('ds', 'Thing', id);
const node = (id: string, rank: number, marks: Record<string, unknown> = {}) => ({
  id: addr(id),
  kind: 'entity' as const,
  type: 'Thing',
  label: id,
  data: { rank, ...marks },
});

type ArrangePayload = Parameters<NonNullable<GraphViewProps['onNodeArrange']>>[0];

/** A parent over `a` and the card under test, laid out as a forest, reporting each arrange. */
async function mountTree(marks: Record<string, unknown> = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const arranged: ArrangePayload[] = [];
  dispose = render(
    () => (
      <GraphView
        seeds={{
          literal: true,
          nodes: [node('p', 0), node('a', 0), node('card', 1, marks)],
          edges: [
            { id: 'p-a', source: addr('p'), target: addr('a'), type: 'rel' },
            { id: 'p-card', source: addr('p'), target: addr('card'), type: 'rel' },
          ],
        }}
        layout={{
          type: 'forest',
          options: { card: { width: 100, height: 100 }, siblingGap: 20, levelGap: 50, sortBy: 'rank' },
        }}
        nodeStyle={[{ style: { shape: 'card', width: 100, height: 100 } }] as never}
        behaviours={['arrange-nodes']}
        onNodeArrange={(payload) => arranged.push(payload)}
      />
    ),
    host,
  );
  // The seeds load asynchronously; nothing is hittable until they land.
  for (let i = 0; i < 50 && host.querySelectorAll('.we-graph__node').length < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const surface = host.querySelector('.we-graph__surface') as HTMLElement;
  /** A pointer event at a world point — the camera is untouched, so world and screen are one here. */
  const pointer = (type: string, x: number, y: number, buttons = 1) =>
    surface.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, buttons, pointerId: 1 }));

  /**
   * Pick `card` up and let go past `a`'s middle — a sibling drop before it.
   *
   * The forest lays the children side by side at x 50 and 170, one level (y 150) under p.
   */
  const dropBeforeA = () => {
    pointer('pointerdown', 170, 150);
    pointer('pointermove', 20, 150);
    pointer('pointerup', 20, 150, 0);
  };
  return { arranged, dropBeforeA };
}

describe('what an arrange drop reports', () => {
  it('hands the drop to onNodeArrange as a record, with the place it landed', async () => {
    const { arranged, dropBeforeA } = await mountTree();
    dropBeforeA();

    expect(arranged).toEqual([
      expect.objectContaining({
        recordId: 'card',
        recordType: 'Thing',
        into: 'sibling',
        targetId: 'a',
        targetType: 'Thing',
        before: true,
        order: ['card', 'a'],
      }),
    ]);
  });

  it('marks a card still awaiting acceptance as pending', async () => {
    const { arranged, dropBeforeA } = await mountTree({ pending: true });
    dropBeforeA();

    expect(arranged).toHaveLength(1);
    expect(arranged[0].pending).toBe(true);
    expect(arranged[0].changed).toBeUndefined();
  });

  it('marks a card carrying a staged change as changed', async () => {
    const { arranged, dropBeforeA } = await mountTree({ changed: true });
    dropBeforeA();

    expect(arranged).toHaveLength(1);
    expect(arranged[0].changed).toBe(true);
    expect(arranged[0].pending).toBeUndefined();
  });

  it('carries neither mark on a settled card', async () => {
    const { arranged, dropBeforeA } = await mountTree();
    dropBeforeA();

    expect(arranged).toHaveLength(1);
    expect(arranged[0]).not.toHaveProperty('pending');
    expect(arranged[0]).not.toHaveProperty('changed');
  });
});
