import type { ModelManifestEntry } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

import { gatherTranscriptTurns, type TurnModel } from '@shared/interpretation/transcriptTurns';

const manifest: ModelManifestEntry[] = [
  {
    name: 'CollectionBlock',
    targetClass: 'we://CollectionBlock',
    properties: [
      {
        name: 'children',
        predicate: 'we://children',
        type: 'uri',
        isCollection: true,
        required: false,
        writable: true,
      },
    ],
  },
];

function model(rows: Record<string, unknown>[], spy?: (options: Record<string, unknown>) => void): TurnModel {
  return {
    async findAll(_handle, options) {
      spy?.(options);
      return rows;
    },
  };
}

const deps = (rows: Record<string, unknown>[], spy?: (o: Record<string, unknown>) => void) => ({
  modelFor: (entity: string) => (entity === 'TextBlock' ? model(rows, spy) : undefined),
  handle: {},
  manifest,
});

describe('gatherTranscriptTurns', () => {
  it('reads children through the containment predicate the manifest declares', async () => {
    let seen: Record<string, unknown> | undefined;
    await gatherTranscriptTurns(
      deps([], (options) => {
        seen = options;
      }),
      'call-1',
    );
    expect(seen?.parent).toEqual({ id: 'call-1', predicate: 'we://children' });
  });

  it('returns nothing when the dataset has no collection schema — a foreign space, not a bug', async () => {
    const turns = await gatherTranscriptTurns({ ...deps([{ text: 'hi' }]), manifest: [] }, 'call-1');
    expect(turns).toEqual([]);
  });

  it('normalises the epoch milliseconds the ORM parses timestamps into', async () => {
    const turns = await gatherTranscriptTurns(deps([{ text: 'hi', author: 'did:a', createdAt: 1_700_000_000_000 }]), 'c');
    expect(turns).toEqual([{ speaker: 'did:a', text: 'hi', timestamp: '2023-11-14T22:13:20.000Z' }]);
  });

  it('accepts an ISO string too, since the ORM does not always parse it', async () => {
    const turns = await gatherTranscriptTurns(
      deps([{ text: 'hi', author: 'did:a', createdAt: '2026-08-13T10:00:00.000Z' }]),
      'c',
    );
    expect(turns[0]?.timestamp).toBe('2026-08-13T10:00:00.000Z');
  });

  it('orders by when it was said, not by how storage returned it', async () => {
    const turns = await gatherTranscriptTurns(
      deps([
        { text: 'second', author: 'did:b', createdAt: 2_000 },
        { text: 'first', author: 'did:a', createdAt: 1_000 },
      ]),
      'c',
    );
    expect(turns.map((t) => t.text)).toEqual(['first', 'second']);
  });

  it('drops turns that cannot be identified or understood', async () => {
    // Each of these is either meaningless to the model or unidentifiable to a processed-turn
    // cursor, and passing it on spends tokens to confuse the run.
    const turns = await gatherTranscriptTurns(
      deps([
        { text: '   ', author: 'did:a', createdAt: 1_000 },
        { text: 'no author', createdAt: 2_000 },
        { text: 'bad date', author: 'did:a', createdAt: 'not-a-date' },
        { text: 'no date', author: 'did:a' },
        { text: 'kept', author: 'did:a', createdAt: 3_000 },
      ]),
      'c',
    );
    expect(turns.map((t) => t.text)).toEqual(['kept']);
  });

  it('trims, so leading whitespace from a flush does not reach the prompt', async () => {
    const turns = await gatherTranscriptTurns(deps([{ text: '  hello  ', author: 'did:a', createdAt: 1 }]), 'c');
    expect(turns[0]?.text).toBe('hello');
  });
});
