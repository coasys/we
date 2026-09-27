/**
 * A card's reaction mark, pressed.
 *
 * The mark draws from the weighing the canvas seed put on the card. A press writes the reaction and
 * the mark moves at once — the score and the filled glyph — rather than a second later when the write
 * comes back through a subscription, which is what makes a press read as having worked.
 */
import { render } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { writes } = vi.hoisted(() => ({ writes: [] as [string, string, number | null][] }));

vi.mock('@we/entities', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@we/entities');
  return {
    ...actual,
    SignalType: {
      findOne: async () => ({ id: 'like', name: 'Like', icon: 'heart', mode: 'toggle', rangeMin: 0, rangeMax: 1 }),
    },
    Signal: { findAll: async () => [] },
  };
});
vi.mock('../src/frameworks/solid/stores/DatasetStore', () => ({
  useDatasetStore: () => ({ currentDataset: () => ({ id: 'ds', handle: {} }) }),
}));
vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({
  useSessionStore: () => ({ me: () => ({ did: 'did:me' }) }),
}));
vi.mock('../src/frameworks/solid/stores/SpaceStore', async () => {
  const { signalOptimism } = await import('../src/shared/signalOptimism');
  return {
    useSpaceStore: () => ({
      mutedDids: () => [],
      upsertSignal: async (node: string, type: string, value: number | null) => {
        writes.push([node, type, value]);
        signalOptimism.hold(node, type, value);
      },
    }),
  };
});

import { ReactionBadge } from '../src/frameworks/solid/components/ReactionBadge';
import { signalOptimism } from '../src/shared/signalOptimism';

beforeEach(() => {
  writes.length = 0;
  signalOptimism.reset();
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
  it('shows the card’s score, and a press counts the reader in at once', async () => {
    const { container } = render(() => <ReactionBadge node={node} recordId="n1" recordType="Note" />);
    await vi.waitFor(() => expect(container.querySelector('.reaction-badge')).not.toBeNull());
    expect(scoreIn(container)).toBe(2);

    press(container);

    expect(writes).toEqual([['n1', 'like', 1]]);
    await vi.waitFor(() => expect(scoreIn(container)).toBe(3));
  });

  it('takes the reader’s like back when they already gave one', async () => {
    const liked = { ...node, data: { ...node.data, weightMine: 1 } };
    const { container } = render(() => <ReactionBadge node={liked} recordId="n1" recordType="Note" />);
    await vi.waitFor(() => expect(container.querySelector('we-button')).not.toBeNull());

    press(container);

    expect(writes).toEqual([['n1', 'like', null]]);
    await vi.waitFor(() => expect(scoreIn(container)).toBe(1));
  });
});
