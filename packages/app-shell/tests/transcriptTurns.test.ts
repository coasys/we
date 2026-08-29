import { gatherTranscriptTurns, type TurnRecord } from '@shared/interpretation/transcriptTurns';
import { containmentPredicate } from '@shared/interpretation/transcriptTurns';
import type { EntityManifestEntry } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

function model(rows: Record<string, unknown>[], spy?: (options: Record<string, unknown>) => void): TurnRecord {
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
  containmentPredicate: 'we://children',
});

describe('gatherTranscriptTurns', () => {
  it('reads children through the containment predicate the caller resolved', async () => {
    let seen: Record<string, unknown> | undefined;
    await gatherTranscriptTurns(
      deps([], (options) => {
        seen = options;
      }),
      'call-1',
    );
    expect(seen?.parent).toEqual({ id: 'call-1', predicate: 'we://children' });
  });

  it('returns nothing when the caller could not resolve one — a foreign space, not a bug', async () => {
    const turns = await gatherTranscriptTurns({ ...deps([{ text: 'hi' }]), containmentPredicate: '' }, 'call-1');
    expect(turns).toEqual([]);
  });

  it('normalises the epoch milliseconds the ORM parses timestamps into', async () => {
    const turns = await gatherTranscriptTurns(
      deps([{ text: 'hi', author: 'did:a', createdAt: 1_700_000_000_000 }]),
      'c',
    );
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

/**
 * Resolving the containment predicate.
 *
 * The regression this exists for: reading a *native* model's predicate from the dataset manifest,
 * which carries foreign schemas only. It always missed, so extraction gathered nothing and reported
 * "0 records found" — indistinguishable from a conversation with nothing in it — and left the parent
 * link unset, so anything written would have been invisible everywhere.
 */
describe('containmentPredicate', () => {
  const nativeCollection = {
    generateSHACL: () => ({ shape: { properties: [{ name: 'children', path: 'we://children' }] } }),
  };

  const foreignManifest: EntityManifestEntry[] = [
    {
      name: 'CollectionBlock',
      targetClass: 'other://CollectionBlock',
      properties: [
        {
          name: 'children',
          predicate: 'other://children',
          type: 'uri',
          isCollection: true,
          required: false,
          writable: true,
        },
      ],
    },
  ];

  it('answers from the native model, which the manifest never carries', () => {
    // The manifest is empty here exactly as it is in a real WE space: native schemas are
    // deliberately absent from it, so this is the only source that can answer.
    expect(containmentPredicate(() => nativeCollection, [])).toBe('we://children');
  });

  it('falls back to the manifest for a container the native registry never heard of', () => {
    expect(containmentPredicate(() => undefined, foreignManifest)).toBe('other://children');
  });

  it('prefers the native model when both could answer', () => {
    expect(containmentPredicate(() => nativeCollection, foreignManifest)).toBe('we://children');
  });

  it('gives up rather than guessing when neither knows', () => {
    expect(containmentPredicate(() => undefined, [])).toBeUndefined();
  });
});
