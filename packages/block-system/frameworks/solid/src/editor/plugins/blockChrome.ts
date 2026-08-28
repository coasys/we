/**
 * Hover and focus, as decorations.
 *
 * The old editor stamped `data-block-hovered` / `data-block-focused` onto block elements by hand.
 * ProseMirror owns its DOM and re-renders nodes as the document changes, so an attribute set from
 * outside is one edit away from vanishing; a node decoration is the sanctioned way to put an
 * attribute on a block's element, and it survives every re-render for free. The attribute names
 * are kept so the stylesheet is unchanged.
 */
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

import { focusedBlock } from '../blockIndex';

export interface BlockChromeState {
  /** Position of the block the pointer is over, or null. */
  hovered: number | null;
}

export const blockChromeKey = new PluginKey<BlockChromeState>('we-block-chrome');

export function blockChromePlugin(): Plugin<BlockChromeState> {
  return new Plugin<BlockChromeState>({
    key: blockChromeKey,
    state: {
      init: () => ({ hovered: null }),
      apply(tr, prev) {
        const meta = tr.getMeta(blockChromeKey) as Partial<BlockChromeState> | undefined;
        let hovered = meta && 'hovered' in meta ? (meta.hovered ?? null) : prev.hovered;
        if (hovered !== null && tr.docChanged) {
          const mapped = tr.mapping.mapResult(hovered);
          hovered = mapped.deleted ? null : mapped.pos;
        }
        return hovered === prev.hovered && !meta ? prev : { hovered };
      },
    },
    props: {
      decorations(state) {
        const { hovered } = blockChromeKey.getState(state) ?? { hovered: null };
        const decorations: Decoration[] = [];
        const focused = focusedBlock(state);
        if (focused) decorations.push(nodeAttr(focused.pos, focused.node, 'data-block-focused'));
        if (hovered !== null && hovered !== focused?.pos) {
          const node = state.doc.nodeAt(hovered);
          if (node) decorations.push(nodeAttr(hovered, node, 'data-block-hovered'));
        }
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

function nodeAttr(pos: number, node: PMNode, attr: string): Decoration {
  return Decoration.node(pos, pos + node.nodeSize, { [attr]: 'true' });
}
