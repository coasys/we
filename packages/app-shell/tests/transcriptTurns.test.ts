import { gatherTranscriptTurns, type TurnRecord } from '@shared/interpretation/transcriptTurns';
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
});

describe('gatherTranscriptTurns', () => {
  it('reads a collection’s parts by the relation that holds them, never by how it is stored', async () => {
    let seen: Record<string, unknown> | undefined;
    await gatherTranscriptTurns(
      deps([], (options) => {
        seen = options;
      }),
      'call-1',
    );
    expect(seen?.parent).toEqual({ id: 'call-1', relation: 'children', entity: 'CollectionBlock' });
    // With each line's thread, which is where its replies are.
    expect(seen?.include).toEqual({ thread: true });
  });

  it('reads the replies in each line’s thread as turns of the conversation, each once', async () => {
    const reply = { id: 'r', text: 'yes', author: 'did:b', createdAt: 2_000, source: 'typed' };
    const turns = await gatherTranscriptTurns(
      deps([
        {
          id: 'q',
          text: 'lunch at 1?',
          author: 'did:a',
          createdAt: 1_000,
          source: 'spoken',
          // A call held about the line is in its thread too, and is not something said.
          thread: [reply, { id: 'call', kind: 'call', mode: 'feed', author: 'did:c', createdAt: 3_000 }],
        },
        // The same reply handed over twice is one turn.
        { id: 'r2', text: 'later', author: 'did:a', createdAt: 4_000, source: 'spoken', thread: [reply] },
      ]),
      'c',
    );
    expect(turns.map((t) => t.text)).toEqual(['lunch at 1?', 'yes', 'later']);
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
