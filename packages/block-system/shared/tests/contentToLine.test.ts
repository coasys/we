/**
 * A composition as one line — what the one-line composer sends.
 *
 * A line is one record however it was typed, so pasted paragraphs join with line breaks, and every
 * mark after the first paragraph has to move along by what came before it, or a mention lands on
 * the wrong word.
 */
import { describe, expect, it } from 'vitest';

import { contentToLine } from '../src';

describe('contentToLine', () => {
  it('joins paragraphs with breaks and moves each one’s marks along', () => {
    const line = contentToLine([
      { _type: 'block', text: 'hi', marks: [{ start: 0, end: 2, type: 'strong' }] },
      { _type: 'block', text: '@Ann there', marks: [{ start: 0, end: 4, type: 'mention', did: 'did:ann' }] },
    ]);
    expect(line.text).toBe('hi\n@Ann there');
    expect(line.marks).toEqual([
      { start: 0, end: 2, type: 'strong' },
      { start: 3, end: 7, type: 'mention', did: 'did:ann' },
    ]);
  });

  it('leaves out what is not text, and the empty space after the last word', () => {
    const line = contentToLine([{ _type: 'block', text: 'look  ' }, { _type: 'image', src: 'x' } as never]);
    expect(line).toEqual({ text: 'look', marks: [] });
  });
});
