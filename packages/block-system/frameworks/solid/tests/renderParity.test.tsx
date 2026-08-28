/**
 * The renderer and the composer must draw the same DOM for the same content.
 *
 * Both go through the one schema — the composer through ProseMirror's view, the renderer through
 * the schema's serializer — so this cannot drift by construction; the test is the proof that the
 * construction holds, over a fixture that exercises every text-block shape and every mark.
 * Editor-private attributes (`contenteditable`, ProseMirror's own classes and decorations) are
 * stripped before comparing, since those are what the composer adds on top of the shared spec.
 */
import type { ContentBlock } from '@we/block-shared';
import { DOMSerializer } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { describe, expect, it } from 'vitest';

import { contentToDoc } from '../src/editor/converter';
import { createBlockSchema } from '../src/editor/schema';

const schema = createBlockSchema([]);

const fixture: ContentBlock[] = [
  { _type: 'block', _key: 'a', style: 'h1', text: 'Title', marks: [{ start: 0, end: 5, type: 'em' }] },
  {
    _type: 'block',
    _key: 'b',
    style: 'normal',
    text: 'bold, link, code, strike, under\nnext line @anna',
    marks: [
      { start: 0, end: 4, type: 'strong' },
      { start: 6, end: 10, type: 'link', href: 'https://x' },
      { start: 12, end: 16, type: 'code' },
      { start: 18, end: 24, type: 'strike' },
      { start: 26, end: 31, type: 'underline' },
      { start: 42, end: 47, type: 'mention', did: 'did:key:anna' },
    ],
  },
  { _type: 'block', _key: 'c', style: 'blockquote', text: 'quoted', format: 'center' },
  { _type: 'block', _key: 'd', style: 'normal', listItem: 'bullet', text: 'one' },
  { _type: 'block', _key: 'e', style: 'normal', listItem: 'bullet', level: 1, text: 'two' },
  { _type: 'block', _key: 'f', style: 'normal', listItem: 'number', text: 'three' },
  { _type: 'block', _key: 'g', style: 'normal', listItem: 'check', checked: true, text: 'done' },
  { _type: 'block', _key: 'h', style: 'normal', level: 2, text: 'indented', direction: 'rtl' },
];

/** The composer's DOM, minus what only an editor adds. */
function composerHtml(blocks: ContentBlock[]): string {
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const view = new EditorView(mount, { state: EditorState.create({ schema, doc: contentToDoc(schema, blocks) }) });
  const html = normalize(view.dom.innerHTML);
  view.destroy();
  mount.remove();
  return html;
}

/** The renderer's DOM: the same schema's serializer over the same nodes. */
function rendererHtml(blocks: ContentBlock[]): string {
  const doc = contentToDoc(schema, blocks);
  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(doc.content);
  const holder = document.createElement('div');
  holder.appendChild(fragment);
  return normalize(holder.innerHTML);
}

function normalize(html: string): string {
  return html
    .replace(/<br class="ProseMirror-trailingBreak">/g, '')
    .replace(/\s?contenteditable="[^"]*"/g, '')
    .replace(/\s?class="ProseMirror[^"]*"/g, '')
    .replace(/\s?draggable="[^"]*"/g, '');
}

describe('composer and renderer DOM', () => {
  it('agree for every text-block shape and every mark', () => {
    expect(composerHtml(fixture)).toBe(rendererHtml(fixture));
  });

  it('is the DOM the stylesheet is written against', () => {
    const html = rendererHtml(fixture);
    expect(html).toContain('<h1><em>Title</em></h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<a href="https://x" target="_blank" rel="noopener noreferrer">link</a>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<s>strike</s>');
    expect(html).toContain('<u>under</u>');
    expect(html).toContain('<br>');
    expect(html).toContain('<span class="we-mention" data-did="did:key:anna">@anna</span>');
    expect(html).toMatch(/<blockquote style="text-align: center;?">quoted<\/blockquote>/);
    expect(html).toContain('<div class="we-list-item" data-list-type="bullet">one</div>');
    expect(html).toContain('<div class="we-list-item" data-level="1" data-list-type="bullet">two</div>');
    expect(html).toContain('data-list-type="check" data-checked="true"');
    expect(html).toContain('<p dir="rtl" data-level="2">indented</p>');
  });
});
