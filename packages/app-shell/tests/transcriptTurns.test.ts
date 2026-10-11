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
  containmentPredicate: 'we://child',
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
    expect(seen?.parent).toEqual({ id: 'call-1', predicate: 'we://child' });
  });

  it('returns nothing when the caller could not resolve one — a foreign space, not a bug', async () => {
    const turns = await gatherTranscriptTurns({ ...deps([{ text: 'hi' }]), containmentPredicate: '' }, 'call-1');
    expect(turns).toEqual([]);
  });

  it('normalises the epoch milliseconds the ORM parses timestamps into', async () => {
    const turns = await gatherTranscriptTurns(
      deps([{ text: 'hi', author: 'did:a', createdAt: 1_700_000_000_000, source: 'spoken' }]),
      'c',
    );
    expect(turns).toEqual([{ speaker: 'did:a', text: 'hi', timestamp: '2023-11-14T22:13:20.000Z', source: 'spoken' }]);
  });

  it('accepts an ISO string too, since the ORM does not always parse it', async () => {
    const turns = await gatherTranscriptTurns(
      deps([{ text: 'hi', author: 'did:a', createdAt: '2026-08-13T10:00:00.000Z', source: 'spoken' }]),
      'c',
    );
    expect(turns[0]?.timestamp).toBe('2026-08-13T10:00:00.000Z');
  });

  it('orders by when it was said, not by how storage returned it', async () => {
    const turns = await gatherTranscriptTurns(
      deps([
        { text: 'second', author: 'did:b', createdAt: 2_000, source: 'spoken' },
        { text: 'first', author: 'did:a', createdAt: 1_000, source: 'spoken' },
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
        { text: '   ', author: 'did:a', createdAt: 1_000, source: 'spoken' },
        { text: 'no author', createdAt: 2_000 },
        { text: 'bad date', author: 'did:a', createdAt: 'not-a-date', source: 'spoken' },
        { text: 'no date', author: 'did:a' },
        { text: 'kept', author: 'did:a', createdAt: 3_000, source: 'spoken' },
      ]),
      'c',
    );
    expect(turns.map((t) => t.text)).toEqual(['kept']);
  });

  it('trims, so leading whitespace from a flush does not reach the prompt', async () => {
    const turns = await gatherTranscriptTurns(
      deps([{ text: '  hello  ', author: 'did:a', createdAt: 1, source: 'spoken' }]),
      'c',
    );
    expect(turns[0]?.text).toBe('hello');
  });

  it('reads only what a person said or wrote', async () => {
    // A bot writing into a call does not know the field, so its replies arrive with no source — and
    // read back in as input, a summary that mentions three tasks is extracted into three more.
    const turns = await gatherTranscriptTurns(
      deps([
        { text: 'said', author: 'did:a', createdAt: 1, source: 'spoken' },
        { text: 'typed', author: 'did:a', createdAt: 2, source: 'typed' },
        { text: 'mended', author: 'did:a', createdAt: 3, source: 'corrected' },
        { text: 'a bot summary', author: 'did:bot', createdAt: 4 },
        { text: 'an older block', author: 'did:a', createdAt: 5, source: '' },
      ]),
      'c',
    );
    expect(turns.map((t) => t.text)).toEqual(['said', 'typed', 'mended']);
  });

  it('follows replies down from each message, in one read', async () => {
    let seen: Record<string, unknown> | undefined;
    const turns = await gatherTranscriptTurns(
      deps(
        [
          {
            text: 'question',
            author: 'did:a',
            createdAt: 1,
            source: 'typed',
            comments: [
              {
                text: 'answer',
                author: 'did:b',
                createdAt: 3,
                source: 'typed',
                comments: [{ text: 'thanks', author: 'did:a', createdAt: 4, source: 'typed' }],
              },
              { text: 'a bot chiming in', author: 'did:bot', createdAt: 2 },
            ],
          },
        ],
        (options) => {
          seen = options;
        },
      ),
      'c',
    );
    expect(turns.map((t) => t.text)).toEqual(['question', 'answer', 'thanks']);
    expect(seen?.include).toMatchObject({ comments: { include: { comments: { include: { comments: true } } } } });
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
    generateSHACL: () => ({ shape: { properties: [{ name: 'children', path: 'we://child' }] } }),
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
    expect(containmentPredicate(() => nativeCollection, [])).toBe('we://child');
  });

  it('falls back to the manifest for a container the native registry never heard of', () => {
    expect(containmentPredicate(() => undefined, foreignManifest)).toBe('other://children');
  });

  it('prefers the native model when both could answer', () => {
    expect(containmentPredicate(() => nativeCollection, foreignManifest)).toBe('we://child');
  });

  it('gives up rather than guessing when neither knows', () => {
    expect(containmentPredicate(() => undefined, [])).toBeUndefined();
  });
});

describe('how a turn came to be', () => {
  /*
    A consumer that renders or exports these is asserting somebody's words. Once a person can type
    into a transcript, or mend what the recogniser heard, "who said it" stops being the whole story
    — so the block's own answer travels with the turn. See `TextBlock.source`.
  */
  it('carries what the block says about itself', async () => {
    const turns = await gatherTranscriptTurns(
      deps([{ text: 'hi', author: 'did:a', createdAt: 1_700_000_000_000, source: 'typed' }]),
      'call-1',
    );

    expect(turns[0].source).toBe('typed');
  });
});
