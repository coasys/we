/**
 * Connections a host has written and not yet seen come back, drawn as if they had.
 *
 * The host thinks in records and the graph draws nodes and edges, so what is asserted is the round trip
 * across that seam: a line the host names by two record ids is drawn between the cards standing for them,
 * a connection it names as removed stops being drawn, and what the graph reports back is its own data in
 * records — never the promises it is drawing on the host's behalf.
 */
import { entityAddress } from '@we/graph-protocol';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import { GraphView } from './GraphView.solid';
import type { ObservedConnection, PendingConnections } from './GraphView.types';

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

const card = (id: string, x: number) => ({
  id: entityAddress('ds', 'Card', id),
  kind: 'entity' as const,
  type: 'Card',
  label: id,
  data: { x, y: 100 },
});

const NONE: PendingConnections = { added: [], moved: [], removed: [] };

describe('pending connections', () => {
  it('draws a line the host has written, hides one it is deleting, and reports only its own data', async () => {
    const [pending, setPending] = createSignal<PendingConnections>(NONE);
    const observed: ObservedConnection[][] = [];
    const el = document.createElement('div');
    document.body.append(el);
    dispose = render(
      () => (
        <GraphView
          seeds={{
            literal: true,
            nodes: [card('a', 100), card('b', 400), card('c', 700)],
            edges: [
              {
                id: 'line-ab',
                source: entityAddress('ds', 'Card', 'a'),
                target: entityAddress('ds', 'Card', 'b'),
                type: 'Relationship',
                reifiedAs: entityAddress('ds', 'Relationship', 'r1'),
              },
            ],
          }}
          layout={{ type: 'manual' }}
          nodeStyle={[{ style: { shape: 'card', width: 120, height: 80 } }] as never}
          host={
            {
              pendingConnections: pending,
              observeConnections: (lines: ObservedConnection[]) => observed.push(lines),
            } as never
          }
        />
      ),
      el,
    );
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
    const lines = () => el.querySelectorAll('svg.we-graph__edges > g').length;
    await settle();
    expect(lines()).toBe(1);

    // A line from a to c, named by records — drawn before anything has been written back.
    setPending({ ...NONE, added: [{ key: 'k1', source: 'a', target: 'c' }] });
    await settle();
    expect(lines()).toBe(2);
    // What comes back is the data: the one stored line, in records — not the promise beside it.
    expect(observed.at(-1)).toEqual([{ id: 'r1', source: 'a', target: 'b' }]);

    // The stored line, being deleted.
    setPending({ ...NONE, removed: ['r1'] });
    await settle();
    expect(lines()).toBe(0);

    // A record the canvas is not showing has nothing to draw.
    setPending({ ...NONE, added: [{ key: 'k2', source: 'a', target: 'elsewhere' }] });
    await settle();
    expect(lines()).toBe(1);
  });
});
