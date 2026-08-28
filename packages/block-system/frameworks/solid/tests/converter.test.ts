/**
 * The editor seam: content blocks ⇄ ProseMirror document, both ways, losslessly.
 *
 * The schema is built from a fixed set of custom types rather than the live registry, so the test
 * pins the converter alone. Everything a content block can express must survive the round trip:
 * styles, list kinds and levels, checked state, alignment, every decorator, links, mentions (a mark
 * on one side, an atom on the other), newlines, nested collections, and blocks whose type the
 * schema does not know.
 */
import type { ContentBlock, TextContentBlock } from '@we/block-shared';
import { describe, expect, it } from 'vitest';

import { contentToDoc, docToContent, inlineContent, inlineToStandoff } from '../src/editor/converter';
import { createBlockSchema } from '../src/editor/schema';

const schema = createBlockSchema(['image', 'task', 'code']);

function roundTrip(blocks: ContentBlock[]): ContentBlock[] {
  return docToContent(contentToDoc(schema, blocks));
}

describe('content → doc → content', () => {
  it('keeps every text-block style, list kind, level and alignment', () => {
    const blocks: ContentBlock[] = [
      { _type: 'block', _key: 'a', style: 'normal', text: 'para' },
      { _type: 'block', _key: 'b', style: 'h2', text: 'title', align: 'center' },
      { _type: 'block', _key: 'c', style: 'blockquote', text: 'quote', direction: 'rtl' },
      { _type: 'block', _key: 'd', style: 'normal', listItem: 'bullet', text: 'item' },
      { _type: 'block', _key: 'e', style: 'normal', listItem: 'number', level: 2, text: 'nested' },
      { _type: 'block', _key: 'f', style: 'normal', listItem: 'check', checked: true, text: 'done' },
      { _type: 'block', _key: 'g', style: 'normal', level: 1, text: 'indented' },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it('keeps marks, with offsets in code points across an emoji', () => {
    const block: TextContentBlock = {
      _type: 'block',
      _key: 'm',
      style: 'normal',
      text: 'a😀 bold link',
      marks: [
        { start: 3, end: 7, type: 'strong' },
        { start: 8, end: 12, type: 'link', href: 'https://x' },
        { start: 3, end: 12, type: 'em' },
      ],
    };
    const [back] = roundTrip([block]) as TextContentBlock[];
    expect(back.text).toBe(block.text);
    expect(back.marks).toEqual([
      { start: 3, end: 7, type: 'strong' },
      { start: 3, end: 12, type: 'em' },
      { start: 8, end: 12, type: 'link', href: 'https://x' },
    ]);
  });

  it('turns a mention mark into a mention node and back', () => {
    const block: TextContentBlock = {
      _type: 'block',
      _key: 'm',
      style: 'normal',
      text: 'hi @anna!',
      marks: [{ start: 3, end: 8, type: 'mention', did: 'did:key:anna' }],
    };
    const doc = contentToDoc(schema, [block]);
    const para = doc.firstChild!;
    expect(para.childCount).toBe(3);
    expect(para.child(1).type.name).toBe('mention');
    expect(para.child(1).attrs).toEqual({ did: 'did:key:anna', text: '@anna' });
    expect(roundTrip([block])).toEqual([block]);
  });

  it('turns newlines into hard breaks and back', () => {
    const block: TextContentBlock = { _type: 'block', _key: 'n', style: 'normal', text: 'one\ntwo' };
    const doc = contentToDoc(schema, [block]);
    expect(doc.firstChild!.child(1).type.name).toBe('hard_break');
    expect(roundTrip([block])).toEqual([block]);
  });

  it('carries a custom block as an atom with its fields in props', () => {
    const blocks: ContentBlock[] = [{ _type: 'image', _key: 'i', src: 'Qm://x', altText: 'alt', width: 66 }];
    const doc = contentToDoc(schema, blocks);
    expect(doc.firstChild!.type.name).toBe('image');
    expect(doc.firstChild!.attrs).toEqual({ id: 'i', props: { src: 'Qm://x', altText: 'alt', width: 66 } });
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it('a block type that shares its name with a mark still round-trips as itself', () => {
    const blocks: ContentBlock[] = [
      { _type: 'code', _key: 'c', code: 'x = 1', language: 'py' },
      { _type: 'block', _key: 'p', style: 'normal', text: 'inline', marks: [{ start: 0, end: 6, type: 'code' }] },
    ];
    const doc = contentToDoc(schema, blocks);
    expect(doc.firstChild!.type.name).toBe('code_block');
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it('keeps a block the schema does not know, untouched', () => {
    const blocks: ContentBlock[] = [{ _type: 'poll', _key: 'p', question: 'Which?', options: ['a', 'b'] }];
    const doc = contentToDoc(schema, blocks);
    expect(doc.firstChild!.type.name).toBe('unknown_block');
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it('nests a collection as a node with children', () => {
    const blocks: ContentBlock[] = [
      {
        _type: 'collection',
        _key: 'c',
        layout: 'row',
        columnCount: 3,
        content: [
          { _type: 'block', _key: 'x', style: 'normal', text: 'inside' },
          { _type: 'image', _key: 'y', src: 'z' },
        ],
      },
    ];
    expect(roundTrip(blocks)).toEqual(blocks);
  });

  it('an empty composition becomes the one paragraph a cursor needs', () => {
    const doc = contentToDoc(schema, []);
    expect(doc.childCount).toBe(1);
    expect(doc.firstChild!.type.name).toBe('paragraph');
    expect(docToContent(doc)).toEqual([{ _type: 'block', style: 'normal', text: '' }]);
  });

  it('an empty collection gets a paragraph inside, and reads back as such', () => {
    const [back] = roundTrip([{ _type: 'collection', layout: 'grid', content: [] }]) as Array<{
      content: ContentBlock[];
    }>;
    expect(back.content).toEqual([{ _type: 'block', style: 'normal', text: '' }]);
  });
});

describe('inline content', () => {
  it('merges adjacent text nodes with the same mark into one range', () => {
    const nodes = [
      schema.text('ab', [schema.marks.strong.create()]),
      schema.text('cd', [schema.marks.strong.create()]),
      schema.text('e'),
    ];
    const para = schema.nodes.paragraph.create(null, nodes);
    expect(inlineToStandoff(para)).toEqual({ text: 'abcde', marks: [{ start: 0, end: 4, type: 'strong' }] });
  });

  it('splits at every mark boundary on the way in', () => {
    const nodes = inlineContent(schema, 'abcd', [
      { start: 0, end: 3, type: 'strong' },
      { start: 2, end: 4, type: 'em' },
    ]);
    expect(nodes.map((n) => [n.text, n.marks.map((m) => m.type.name)])).toEqual([
      ['ab', ['strong']],
      ['c', ['strong', 'em']],
      ['d', ['em']],
    ]);
  });
});
