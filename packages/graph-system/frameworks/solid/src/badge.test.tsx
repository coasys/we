/**
 * A mark on a card that a reader can press without picking the card up.
 *
 * A card's content is inert on purpose — a press anywhere on it starts a drag — so a reaction a reader
 * is meant to press cannot live there. A badge sits on the card's edge and keeps its presses: pressed,
 * the card neither moves nor becomes selected, and the badge is told which record it is on.
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

describe('a card’s badge', () => {
  it('draws the host’s mark with the record it is on, and keeps its presses from the canvas', async () => {
    const drags: unknown[] = [];
    const selections: string[][] = [];
    const seen: { recordId?: string; recordType?: string }[] = [];
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(
      () => (
        <GraphView
          seeds={{
            literal: true,
            nodes: [
              {
                id: entityAddress('ds', 'Note', 'n1'),
                kind: 'entity',
                type: 'Note',
                label: 'n1',
                data: { x: 100, y: 100 },
              },
            ],
            edges: [],
          }}
          layout={{ type: 'manual' }}
          nodeStyle={[{ style: { shape: 'card', width: 180, height: 100, badge: 'score' } }] as never}
          behaviours={['select', { type: 'drag-node', options: { pin: true } }, 'pan-zoom']}
          onNodeDragEnd={(payload) => drags.push(payload)}
          onSelectionChange={(ids) => selections.push(ids)}
          host={
            {
              nodeBadges: {
                score: (props: { recordId?: string; recordType?: string }) => {
                  seen.push({ recordId: props.recordId, recordType: props.recordType });
                  return <button class="mark">3</button>;
                },
              },
            } as never
          }
        />
      ),
      host,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    const mark = host.querySelector('.we-graph__badge .mark') as HTMLElement;
    expect(mark).not.toBeNull();
    expect(seen[0]).toEqual({ recordId: 'n1', recordType: 'Note' });

    const at = (type: string, x: number, buttons: number) =>
      new PointerEvent(type, { bubbles: true, clientX: x, clientY: 100, buttons, pointerId: 1 });
    mark.dispatchEvent(at('pointerdown', 100, 1));
    mark.dispatchEvent(at('pointermove', 180, 1));
    mark.dispatchEvent(at('pointerup', 180, 0));
    mark.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(drags).toEqual([]);
    expect(selections.flat()).toEqual([]);
  });
});
