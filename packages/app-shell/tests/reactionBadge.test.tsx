/**
 * A card's reaction mark, pressed.
 *
 * The mark draws from the weighing the canvas seed put on the card. A press invokes the reaction's
 * operation, which the host draws before it lands in the reads the seed weighs from — so what is
 * held here is that the press asks for the right write, and that the mark follows the card's data.
 */
import { render as mount } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { writes } = vi.hoisted(() => ({ writes: [] as [string, Record<string, unknown>][] }));

vi.mock('@we/entities', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@we/entities');
  return {
    ...actual,
    SignalType: {
      findOne: async (_p: unknown, query: { where: { id: string } }) =>
        query.where.id === 'rating'
          ? { id: 'rating', name: 'Confidence', icon: 'gauge', mode: 'slider', rangeMin: 0, rangeMax: 100 }
          : { id: 'like', name: 'Like', icon: 'heart', mode: 'toggle', rangeMin: 0, rangeMax: 1 },
    },
    Signal: { findAll: async () => [] },
  };
});
import { ReactionBadge } from '../src/frameworks/solid/components/ReactionBadge';
import { StoreRegistryContext } from '../src/frameworks/solid/stores/useStore';
import type { StoreRegistry } from '../src/shared/stores/storeRegistry';

/** What the badge reads from the registry, as the host composes it. */
const stores = {
  datasetStore: { currentDataset: () => ({ id: 'ds', handle: {} }) },
  sessionStore: { me: () => ({ did: 'did:me' }) },
  spaceStore: { mutedDids: () => [] },
  // The composition's operation runner: what the badge invokes, recorded here.
  operations: {
    invoke: async (name: string, args: Record<string, unknown>) => {
      writes.push([name, args]);
    },
  },
} as unknown as Partial<StoreRegistry>;

/** Render inside the store registry, as the host's composition hands it to every component. */
function render(ui: () => JSX.Element) {
  return mount(ui, {
    wrapper: (props) => <StoreRegistryContext.Provider value={stores}>{props.children}</StoreRegistryContext.Provider>,
  });
}

beforeEach(() => {
  writes.length = 0;
});

/** The score the mark shows — a property of the number element, not text. */
const scoreIn = (container: HTMLElement) => (container.querySelector('we-number') as { value?: number } | null)?.value;
const press = (container: HTMLElement) => (container.querySelector('we-button') as HTMLElement).click();

const node = {
  id: 'n1',
  kind: 'entity' as const,
  type: 'Note',
  data: { weightType: 'like', weight: 2, weightCount: 2, weightAggregate: 'count' },
};

describe('a card’s reaction mark', () => {
  it('shows the card’s score, and a press gives the reader’s like', async () => {
    const { container } = render(() => <ReactionBadge node={node} recordId="n1" recordType="Note" />);
    await vi.waitFor(() => expect(container.querySelector('.reaction-badge')).not.toBeNull());
    expect(scoreIn(container)).toBe(2);

    press(container);

    expect(writes).toEqual([['core.upsertSignal', { node: 'n1', signalType: 'like', value: 1 }]]);
  });

  it('takes the reader’s like back when they already gave one', async () => {
    const liked = { ...node, data: { ...node.data, weightMine: 1 } };
    const { container } = render(() => <ReactionBadge node={liked} recordId="n1" recordType="Note" />);
    await vi.waitFor(() => expect(container.querySelector('we-button')).not.toBeNull());

    press(container);

    expect(writes).toEqual([['core.withdrawSignal', { node: 'n1', signalType: 'like' }]]);
  });

  it('opens the reaction’s own control for a slider, in the popover’s content', async () => {
    // A press on a slider's mark opened an empty panel: the control was in a slot the popover never draws.
    const slider = {
      ...node,
      data: { weightType: 'rating', weight: 40, weightCount: 2, weightAggregate: 'mean' },
    };
    const { container } = render(() => <ReactionBadge node={slider} recordId="n1" recordType="Note" />);
    await vi.waitFor(() => expect(container.querySelector('we-popover')).not.toBeNull());

    const content = container.querySelector('we-popover > [slot="content"]');
    expect(content).not.toBeNull();
    expect(content?.textContent).toContain('Confidence');
    expect(container.querySelector('we-popover > [slot="trigger"]')).not.toBeNull();
  });
});
