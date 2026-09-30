/**
 * Placeholder text in empty text containers: "Type or press '/' for commands…" in a paragraph, the
 * block's kind elsewhere. Pure decorations — the stylesheet draws `data-placeholder` through a
 * pseudo-element, dimmed unless the block is hovered or holds the caret.
 */
import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

import { focusedBlock, indexBlocks } from '../blockIndex';

function placeholderFor(name: string, attrs: Record<string, unknown>): string {
  switch (name) {
    case 'paragraph':
      return "Type or press '/' for commands...";
    case 'list_item':
      return attrs.listType === 'check' ? 'To do' : 'List item';
    case 'blockquote':
      return 'Quote';
    case 'heading':
      return `Heading ${attrs.headingLevel}`;
    default:
      return '';
  }
}

export function placeholdersPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const focused = focusedBlock(state);
        const decorations: Decoration[] = [];
        for (const { pos, node } of indexBlocks(state.doc)) {
          if (!node.type.isTextblock || node.content.size > 0) continue;
          const text = placeholderFor(node.type.name, node.attrs);
          if (!text) continue;
          const isFocused = focused?.pos === pos;
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, {
              class: `we-block-placeholder-empty${isFocused ? ' we-block-placeholder-focused' : ''}`,
              'data-placeholder': text,
            }),
          );
        }
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}
