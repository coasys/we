/**
 * Typing a URL and a space links the URL — and only the URL, not the punctuation the sentence put
 * after it. The same answer a line drawn from a bot's bare text gets, since both ask `findUrls`.
 */
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { describe, expect, it } from 'vitest';

import { composerInputRules } from '../src/editor/plugins/inputRules';
import { createBlockSchema } from '../src/editor/schema';

const schema = createBlockSchema([]);

/** Type `text` character by character, as the input rules see it, and answer the linked runs. */
function typed(text: string): { text: string; href: string }[] {
  const doc = schema.node('doc', null, [schema.node('paragraph')]);
  const view = new EditorView(document.createElement('div'), {
    state: EditorState.create({ doc, plugins: [composerInputRules(schema)] }),
  });
  for (const ch of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch, () => view.state.tr));
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
  }
  const links: { text: string; href: string }[] = [];
  view.state.doc.descendants((node) => {
    const link = node.marks.find((m) => m.type.name === 'link');
    if (node.isText && link) links.push({ text: node.text ?? '', href: String(link.attrs.href) });
  });
  view.destroy();
  return links;
}

describe('typing a URL', () => {
  it('links it when the space after it is typed', () => {
    expect(typed('see https://example.org/a ')).toEqual([
      { text: 'https://example.org/a', href: 'https://example.org/a' },
    ]);
  });

  it('leaves the full stop that ends the sentence out of the link', () => {
    expect(typed('up at https://github.com/HexaField/sovereign/pull/19. ')).toEqual([
      {
        text: 'https://github.com/HexaField/sovereign/pull/19',
        href: 'https://github.com/HexaField/sovereign/pull/19',
      },
    ]);
  });

  it('leaves out a bracket the URL did not open', () => {
    expect(typed('(see https://example.org/a) ')).toEqual([
      { text: 'https://example.org/a', href: 'https://example.org/a' },
    ]);
  });

  it('gives www. its scheme', () => {
    expect(typed('www.example.org ')).toEqual([{ text: 'www.example.org', href: 'https://www.example.org' }]);
  });
});
