/**
 * The content model's pure half: marks arithmetic, and the Portable Text projection with its
 * inverse. No models, no backend — these are the functions everything else is built on, and they
 * have to be right for every string JavaScript can hold.
 */
import { describe, expect, it } from 'vitest';

import type { ContentBlock, TextContentBlock } from '../src/content';
import { collectKeys, fromPortableText, spansFromStandoff, standoffFromSpans, toPortableText } from '../src/content';
import { cpLength, cpToUtf16, normalizeMarks, parseMarks, serializeMarks, shiftMarks, utf16ToCp } from '../src/marks';
import { decodeEditorState, encodeBase64Utf8 } from '../src/utils';

describe('code point arithmetic', () => {
  it('counts code points, not UTF-16 units', () => {
    expect('a😀b'.length).toBe(4);
    expect(cpLength('a😀b')).toBe(3);
  });

  it('converts between UTF-16 and code-point indexes across an astral character', () => {
    const s = 'a😀b';
    expect(utf16ToCp(s, 3)).toBe(2); // after the emoji (two units)
    expect(cpToUtf16(s, 2)).toBe(3);
    expect(cpToUtf16(s, 3)).toBe(4);
  });

  it('a combining sequence is two code points', () => {
    expect(cpLength('é')).toBe(2);
  });
});

describe('marks', () => {
  it('normalises: sorts, clamps and drops empty ranges', () => {
    const marks = normalizeMarks(
      [
        { start: 5, end: 9, type: 'em' },
        { start: 0, end: 0, type: 'strong' },
        { start: -2, end: 3, type: 'strong' },
        { start: 8, end: 20, type: 'code' },
      ],
      10,
    );
    expect(marks).toEqual([
      { start: 0, end: 3, type: 'strong' },
      { start: 5, end: 9, type: 'em' },
      { start: 8, end: 10, type: 'code' },
    ]);
  });

  it('round-trips through the stored string and stores nothing for none', () => {
    expect(serializeMarks([])).toBe('');
    expect(serializeMarks(undefined)).toBe('');
    const marks = [{ start: 1, end: 2, type: 'link', href: 'https://x' }];
    expect(parseMarks(serializeMarks(marks))).toEqual(marks);
    expect(parseMarks('not json')).toEqual([]);
    expect(parseMarks('')).toEqual([]);
  });

  it('shifts marks around an insertion and a removal', () => {
    const marks = [{ start: 2, end: 6, type: 'strong' }];
    expect(shiftMarks(marks, 4, 3)).toEqual([{ start: 2, end: 9, type: 'strong' }]);
    expect(shiftMarks(marks, 0, 1)).toEqual([{ start: 3, end: 7, type: 'strong' }]);
    // remove [3,5): the mark shortens to cover what is left
    expect(shiftMarks(marks, 3, -2)).toEqual([{ start: 2, end: 4, type: 'strong' }]);
    // remove the whole mark: it is dropped
    expect(shiftMarks(marks, 2, -4)).toEqual([]);
  });
});

describe('Portable Text projection', () => {
  it('derives spans at every mark boundary, decorators by name and annotations by key', () => {
    const { children, markDefs } = spansFromStandoff('Hello @anna, hi', [
      { start: 0, end: 5, type: 'strong' },
      { start: 6, end: 11, type: 'mention', did: 'did:key:anna' },
    ]);
    expect(markDefs).toEqual([{ _key: 'm1', _type: 'mention', did: 'did:key:anna' }]);
    expect(children.map((s) => [s.text, s.marks])).toEqual([
      ['Hello', ['strong']],
      [' ', []],
      ['@anna', ['m1']],
      [', hi', []],
    ]);
  });

  it('overlapping marks become two spans carrying both', () => {
    const { children } = spansFromStandoff('abcd', [
      { start: 0, end: 3, type: 'strong' },
      { start: 2, end: 4, type: 'em' },
    ]);
    expect(children.map((s) => [s.text, s.marks])).toEqual([
      ['ab', ['strong']],
      ['c', ['strong', 'em']],
      ['d', ['em']],
    ]);
  });

  it('slices by code point so an emoji does not split a span', () => {
    const { children } = spansFromStandoff('a😀b', [{ start: 1, end: 2, type: 'strong' }]);
    expect(children.map((s) => s.text)).toEqual(['a', '😀', 'b']);
  });

  it('an empty block still has one empty span', () => {
    expect(spansFromStandoff('', []).children).toEqual([{ _type: 'span', _key: 's1', text: '', marks: [] }]);
  });

  it('spans → standoff is the inverse, merging adjacent spans with the same mark', () => {
    const text = 'Hello @anna, hi';
    const marks = [
      { start: 0, end: 5, type: 'strong' },
      { start: 6, end: 11, type: 'mention', did: 'did:key:anna' },
    ];
    const projected = spansFromStandoff(text, marks);
    expect(standoffFromSpans(projected.children, projected.markDefs)).toEqual({ text, marks });
  });

  it('toPortableText keeps text/marks canonical, adds children/markDefs and a key; fromPortableText strips them', () => {
    const block: TextContentBlock = {
      _type: 'block',
      style: 'h2',
      text: 'Title',
      marks: [{ start: 0, end: 5, type: 'em' }],
    };
    const [projected] = toPortableText([block]) as TextContentBlock[];
    expect(projected._key).toBe('b1');
    expect(projected.text).toBe('Title');
    expect(projected.children).toHaveLength(1);
    expect(projected.children![0].marks).toEqual(['em']);
    const [back] = fromPortableText([projected]) as TextContentBlock[];
    expect(back.children).toBeUndefined();
    expect(back.markDefs).toBeUndefined();
    expect(back.text).toBe('Title');
    expect(back.marks).toEqual(block.marks);
  });

  it('reads a spans-only block a Portable Text producer wrote', () => {
    const pt = [
      {
        _type: 'block',
        _key: 'x',
        style: 'normal',
        markDefs: [{ _key: 'l1', _type: 'link', href: 'https://x' }],
        children: [
          { _type: 'span', _key: 'a', text: 'see ', marks: [] },
          { _type: 'span', _key: 'b', text: 'here', marks: ['l1'] },
        ],
      },
    ] as unknown as ContentBlock[];
    const [block] = fromPortableText(pt) as TextContentBlock[];
    expect(block.text).toBe('see here');
    expect(block.marks).toEqual([{ start: 4, end: 8, type: 'link', href: 'https://x' }]);
  });

  it('projects nested collections in place and collects keys at every depth', () => {
    const blocks: ContentBlock[] = [
      { _type: 'block', _key: 'p1', text: 'a' },
      { _type: 'collection', _key: 'c1', layout: 'grid', content: [{ _type: 'image', _key: 'i1', src: 'x' }] },
    ];
    const projected = toPortableText(blocks);
    expect((projected[1] as { content: ContentBlock[] }).content[0]._key).toBe('i1');
    expect(collectKeys(blocks)).toEqual(['p1', 'c1', 'i1']);
  });
});

describe('decodeEditorState', () => {
  it('decodes UTF-8 base64 — the fixture-documented mojibake bug is gone', () => {
    const blocks: ContentBlock[] = [{ _type: 'block', text: 'héllo — 😀' }];
    const url = `data:application/json;base64,${encodeBase64Utf8(JSON.stringify(toPortableText(blocks)))}`;
    const decoded = decodeEditorState(url) as TextContentBlock[];
    expect(decoded[0].text).toBe('héllo — 😀');
  });

  it('accepts a document and a bare array, and refuses anything else', () => {
    expect(decodeEditorState({ _type: 'document', blocks: [{ _type: 'block', text: 'x' }] })).toHaveLength(1);
    expect(decodeEditorState([{ _type: 'image', src: 'y' }])).toHaveLength(1);
    // The Lexical tree WE stored before the content layer is no longer a composition.
    expect(
      decodeEditorState({ type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'z' }] }] }),
    ).toBeNull();
    expect(decodeEditorState('nonsense')).toBeNull();
    expect(decodeEditorState(42)).toBeNull();
  });
});
