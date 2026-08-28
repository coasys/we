/**
 * Hover, focus and the dragged block, as decorations.
 *
 * The old editor stamped `data-block-hovered` / `data-block-focused` onto block elements by hand.
 * ProseMirror owns its DOM and re-renders nodes as the document changes, so an attribute set from
 * outside is one edit away from vanishing; a node decoration is the sanctioned way to put an
 * attribute on a block's element, and it survives every re-render for free. The attribute names
 * are kept so the stylesheet is unchanged.
 *
 * `dragging` is here for a sharper version of the same reason. Writing the drag source's fade
 * straight onto its element is not merely fragile: the editor's DOM observer reads an outside
 * mutation back as a document change, marks the range dirty and redraws it — replacing the very
 * element the drag is anchored to, mid-drag. A custom block's node view ignores mutations, so
 * images survived it and text blocks could not be dragged at all.
 */
import type { Node as PMNode } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

import { focusedBlock } from '../blockIndex';

export interface BlockChromeState {
  /** Position of the block the pointer is over, or null. */
  hovered: number | null;
  /** Position of the block being dragged by its handle, or null. */
  dragging: number | null;
}

export const blockChromeKey = new PluginKey<BlockChromeState>('we-block-chrome');

export function blockChromePlugin(): Plugin<BlockChromeState> {
  return new Plugin<BlockChromeState>({
    key: blockChromeKey,
    state: {
      init: () => ({ hovered: null, dragging: null }),
      apply(tr, prev) {
        const meta = tr.getMeta(blockChromeKey) as Partial<BlockChromeState> | undefined;
        const next = {
          hovered: mapped(tr, meta && 'hovered' in meta ? (meta.hovered ?? null) : prev.hovered),
          dragging: mapped(tr, meta && 'dragging' in meta ? (meta.dragging ?? null) : prev.dragging),
        };
        return next.hovered === prev.hovered && next.dragging === prev.dragging ? prev : next;
      },
    },
    props: {
      decorations(state) {
        const { hovered, dragging } = blockChromeKey.getState(state) ?? { hovered: null, dragging: null };
        const decorations: Decoration[] = [];
        const focused = focusedBlock(state);
        if (focused) decorations.push(nodeAttr(focused.pos, focused.node, 'data-block-focused'));
        if (hovered !== null && hovered !== focused?.pos) {
          const node = state.doc.nodeAt(hovered);
          if (node) decorations.push(nodeAttr(hovered, node, 'data-block-hovered'));
        }
        if (dragging !== null) {
          const node = state.doc.nodeAt(dragging);
          if (node) decorations.push(nodeAttr(dragging, node, 'data-block-dragging'));
        }
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

/** A remembered position through a transaction's changes; null once the block it marked is gone. */
function mapped(tr: Transaction, pos: number | null): number | null {
  if (pos === null || !tr.docChanged) return pos;
  const result = tr.mapping.mapResult(pos);
  return result.deleted ? null : result.pos;
}

function nodeAttr(pos: number, node: PMNode, attr: string): Decoration {
  return Decoration.node(pos, pos + node.nodeSize, { [attr]: 'true' });
}
