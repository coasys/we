import { describe, expect, it } from 'vitest';

import { isMessage, lineContent, threadLines } from './thread.ts';

type Block = { _type: string; text: string; marks: { start: number; end: number; type: string; href?: string }[] };
const block = (row: Record<string, unknown>) => (lineContent(row) as Block[] | null)?.[0];

describe('lineContent', () => {
  it('draws a line without marks as blocks too, keeping its line breaks in the text', () => {
    const b = block({ text: 'Before merge:\n(B-1) one\n(B-2) two', marks: '' });
    expect(b).toEqual({ _type: 'block', text: 'Before merge:\n(B-1) one\n(B-2) two', marks: [] });
  });

  it('is nothing for a line with no words', () => {
    expect(lineContent({ text: '', marks: '' })).toBeNull();
    expect(lineContent({})).toBeNull();
  });

  it('links a URL its writer left bare, short of the full stop', () => {
    const text = 'Up at https://github.com/coasys/ad4m/pull/1861. Approve.';
    const [link] = block({ text, marks: '' })!.marks;
    expect(link).toMatchObject({ type: 'link', href: 'https://github.com/coasys/ad4m/pull/1861' });
    expect(text.slice(link.start, link.end)).toBe('https://github.com/coasys/ad4m/pull/1861');
  });

  it('keeps the marks the writer stored, and their link wins', () => {
    const text = '@Data see https://x.org';
    const marks = [
      { start: 0, end: 5, type: 'mention', did: 'did:data' },
      { start: 10, end: 23, type: 'link', href: 'https://elsewhere.org' },
    ];
    expect(block({ text, marks })!.marks).toEqual(marks);
  });

  it('draws a line whose marks are not marks, without them', () => {
    expect(block({ text: 'hello', marks: [{ start: 0 }] })!.marks).toEqual([]);
  });
});

describe('lineContent reads a typed line as markdown', () => {
  it('draws the markdown, keeping the writer’s mention and linking bare URLs', () => {
    const text = '## Nightly\n\n- `sfu`: real, see https://x.org/1944.\n\n@Data the log is attached';
    const at = text.indexOf('@Data');
    const marks = [{ start: at, end: at + 5, type: 'mention', did: 'did:data' }];
    const out = lineContent({ text, marks, source: 'typed' }) as Block[];
    expect(out.map((b) => b.text)).toEqual([
      'Nightly',
      'sfu: real, see https://x.org/1944.',
      '@Data the log is attached',
    ]);
    expect(out[1].marks.map((m) => m.type)).toEqual(['code', 'link']);
    expect(out[1].marks[1].href).toBe('https://x.org/1944');
    expect(out[2].marks).toEqual([{ start: 0, end: 5, type: 'mention', did: 'did:data' }]);
  });

  it('draws a bot’s hyphen and number lines as list items', () => {
    const out = lineContent({ text: 'Per job:\n1. sfu: real\n2. harness: runner', marks: '' }) as (Block & {
      listItem?: string;
    })[];
    expect(out.map((b) => [b.text, b.listItem])).toEqual([
      ['Per job:', undefined],
      ['sfu: real', 'number'],
      ['harness: runner', 'number'],
    ]);
  });

  it('draws a spoken or corrected line as said, symbols and all', () => {
    for (const source of ['spoken', 'corrected'])
      expect(lineContent({ text: '# one *two*', marks: '', source })).toEqual([
        { _type: 'block', text: '# one *two*', marks: [] },
      ]);
  });
});

describe('a message — a collection holding its parts', () => {
  const message = (over: Record<string, unknown> = {}) => ({
    id: 'we://m',
    kind: 'message',
    textContent: 'the plan, as typed',
    children: [{ id: 'we://m/1', __subjectClass: 'TextBlock', text: '# kept as typed', style: 'normal', marks: '' }],
    ...over,
  });

  it('is drawn from its parts as they were stored, not parsed again', () => {
    expect(lineContent(message())).toEqual([
      expect.objectContaining({ _type: 'block', _key: 'we://m/1', text: '# kept as typed' }),
    ]);
  });

  it('read without its parts, is drawn from its words', () => {
    expect(block(message({ children: ['we://m/1'], source: 'spoken' }))).toMatchObject({ text: 'the plan, as typed' });
  });

  it('gives its words as `text`, and a reply quotes them', () => {
    const reply = {
      id: 'we://r',
      kind: 'reply',
      textContent: 'agreed',
      respondsTo: 'we://m',
      children: [],
      createdAt: 2,
    };
    const lines = threadLines({ rows: [{ ...message(), createdAt: 1, thread: [reply] }] });
    expect(lines.map((l) => [l.id, l.text])).toEqual([
      ['we://m', 'the plan, as typed'],
      ['we://r', 'agreed'],
    ]);
    expect(lines[1].replyTo).toMatchObject({ id: 'we://m', text: 'the plan, as typed' });
  });

  it('is told apart from a bare text block, which is drawn from its own text', () => {
    expect(isMessage(message())).toBe(true);
    expect(isMessage({ id: 'we://t', text: 'hi' })).toBe(false);
    expect(block({ id: 'we://t', text: 'hi', marks: '' })).toMatchObject({ text: 'hi' });
  });
});
