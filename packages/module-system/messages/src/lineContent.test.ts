import { describe, expect, it } from 'vitest';

import { lineContent } from './thread.ts';

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
    expect(block({ text, marks: JSON.stringify(marks) })!.marks).toEqual(marks);
  });

  it('draws a line whose marks do not parse, without them', () => {
    expect(block({ text: 'hello', marks: '{not json' })!.marks).toEqual([]);
  });
});
