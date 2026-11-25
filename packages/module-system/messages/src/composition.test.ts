import { describe, expect, it } from 'vitest';

import { isMessageComposition, lineText, mendLine, threadLines } from './index.ts';

/*
  A message is a composition (a CollectionBlock with `kind: message`, or `reply`) that holds its words
  in `textContent`. A line can also be a bare TextBlock: every line written before, and every line a
  call hears. Both are lines of the same conversation, and both are drawn and quoted by their words.
*/
describe('the words of a line', () => {
  it('reads a bare line by its text and a message composition by its textContent', () => {
    expect(lineText({ text: 'said aloud' })).toBe('said aloud');
    expect(lineText({ kind: 'message', textContent: 'typed, with files' })).toBe('typed, with files');
    expect(lineText({ kind: 'reply', textContent: 'yes' })).toBe('yes');
  });

  it('gives no words to a collection that is not a message', () => {
    // A call or a group of files is a collection too, and is not something said.
    expect(lineText({ kind: 'call', textContent: 'a call' })).toBe('');
    expect(lineText({ kind: 'attachments' })).toBe('');
    expect(lineText(undefined)).toBe('');
    expect(isMessageComposition({ kind: 'call' })).toBe(false);
    expect(isMessageComposition({ kind: 'message' })).toBe(true);
  });
});

describe('a conversation of bare lines and message compositions', () => {
  it('draws each by its words and quotes each in the replies that answer it', () => {
    const bare = { id: 'bare', text: 'lunch at 1?', author: 'did:a', createdAt: 1 };
    const message = {
      id: 'msg',
      kind: 'message',
      textContent: 'the plan is attached',
      author: 'did:b',
      createdAt: 2,
      // A reply composition to it, and a bare reply.
      thread: [
        { id: 'r1', kind: 'reply', textContent: 'thanks', author: 'did:a', createdAt: 3, respondsTo: 'msg' },
        { id: 'r2', text: 'got it', author: 'did:c', createdAt: 4, respondsTo: 'msg' },
      ],
    };
    const replyToBare = {
      id: 'r3',
      kind: 'reply',
      textContent: 'yes',
      author: 'did:b',
      createdAt: 5,
      respondsTo: 'bare',
    };
    const lines = threadLines({ rows: [bare, message, replyToBare] });
    expect(lines.map((line) => [line.id, line.text])).toEqual([
      ['bare', 'lunch at 1?'],
      ['msg', 'the plan is attached'],
      ['r1', 'thanks'],
      ['r2', 'got it'],
      ['r3', 'yes'],
    ]);
    const quoted = Object.fromEntries(lines.map((line) => [line.id, (line.replyTo as { text?: string })?.text]));
    expect(quoted).toMatchObject({ r1: 'the plan is attached', r2: 'the plan is attached', r3: 'lunch at 1?' });
  });
});

describe('mending a line', () => {
  type Call = [string, ...unknown[]];
  const recordsWith = (message: boolean) => {
    const calls: Call[] = [];
    return {
      calls,
      records: {
        update: async (...args: unknown[]) => {
          calls.push(['update', ...args]);
        },
        find: async (entity: string, ...rest: unknown[]) => {
          calls.push(['find', entity, ...rest]);
          if (!message) return [];
          return entity === 'CollectionBlock' ? [{ id: 'msg', kind: 'message' }] : [{ id: 'msg-words' }];
        },
      },
    };
  };

  it('changes the words of a message composition in its TextBlock and in its textContent, in the target', async () => {
    const { calls, records } = recordsWith(true);
    const target = { dataset: 'call-space' };

    await mendLine(records, 'msg', 'the fixed words', 'corrected', target);

    expect(calls.filter((c) => c[0] === 'update')).toEqual([
      ['update', 'TextBlock', 'msg-words', { text: 'the fixed words', source: 'corrected' }, target],
      ['update', 'CollectionBlock', 'msg', { textContent: 'the fixed words', source: 'corrected' }, target],
    ]);
    expect(calls.filter((c) => c[0] === 'find').every((c) => c.at(-1) === target)).toBe(true);
  });

  it('changes the text of a bare line, and gives no target when it has none', async () => {
    const { calls, records } = recordsWith(false);

    await mendLine(records, 'line', 'the fixed words', undefined);

    expect(calls.filter((c) => c[0] === 'update')).toEqual([
      ['update', 'TextBlock', 'line', { text: 'the fixed words' }],
    ]);
  });

  it('writes a bare line when it cannot find', async () => {
    const calls: unknown[][] = [];
    await mendLine({ update: async (...args: unknown[]) => void calls.push(args) }, 'line', 'words', undefined);
    expect(calls).toEqual([['TextBlock', 'line', { text: 'words' }]]);
  });
});
