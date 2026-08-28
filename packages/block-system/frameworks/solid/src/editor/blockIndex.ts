/**
 * Where the blocks are.
 *
 * Every plugin that draws chrome around a block — handles, placeholders, hover and focus, the drop
 * indicator — needs the same answer: which block-level nodes exist, at what position, at what
 * depth. ProseMirror gives positions rather than identities, so this is recomputed from the
 * document (cheap: a shallow walk) whenever it changes, and each entry can be matched to its DOM
 * through `view.nodeDOM(pos)`.
 */
import type { Node as PMNode, ResolvedPos } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import { NodeSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { COLLECTION_NODE } from './schema';

export interface BlockEntry {
  /** Position before the node. */
  pos: number;
  node: PMNode;
  /** 0 for a top-level block, 1 inside a collection, and so on. */
  depth: number;
  /** Position of the enclosing collection, or null at the top level. */
  parentPos: number | null;
}

/** Every block-level node, depth first, nested collections' children included. */
export function indexBlocks(doc: PMNode): BlockEntry[] {
  const out: BlockEntry[] = [];
  const walk = (parent: PMNode, base: number, depth: number, parentPos: number | null) => {
    parent.forEach((node, offset) => {
      const pos = base + offset;
      out.push({ pos, node, depth, parentPos });
      if (node.type.name === COLLECTION_NODE) walk(node, pos + 1, depth + 1, pos);
    });
  };
  walk(doc, 0, 0, null);
  return out;
}

/** The entry whose DOM is `dom`, if any. */
export function entryForDom(view: EditorView, entries: readonly BlockEntry[], dom: Node): BlockEntry | undefined {
  return entries.find((e) => view.nodeDOM(e.pos) === dom);
}

/** The innermost block containing a resolved position (the textblock the caret is in, or the collection around it). */
export function blockAround($pos: ResolvedPos): { pos: number; node: PMNode } | null {
  for (let depth = $pos.depth; depth >= 1; depth--) {
    const node = $pos.node(depth);
    if (node.isBlock) return { pos: $pos.before(depth), node };
  }
  return null;
}

/** The block the selection is in — the selected node for a node selection, the caret's block otherwise. */
export function focusedBlock(state: EditorState): { pos: number; node: PMNode } | null {
  const { selection } = state;
  if (selection instanceof NodeSelection) return { pos: selection.from, node: selection.node };
  return blockAround(selection.$head);
}

/** Positions of every block that contains the selection, innermost last. */
export function ancestorBlockPositions(state: EditorState): number[] {
  const { selection } = state;
  const out: number[] = [];
  const $pos = selection instanceof NodeSelection ? state.doc.resolve(selection.from + 1) : selection.$head;
  for (let depth = 1; depth <= $pos.depth; depth++) {
    if ($pos.node(depth).isBlock) out.push($pos.before(depth));
  }
  if (selection instanceof NodeSelection) out.push(selection.from);
  return out;
}
