/**
 * The block-level operations the chrome, the keymap and the menus share.
 *
 * Each is a plain ProseMirror command or a function of a view: it builds one transaction and
 * dispatches it, so undo history sees one step per user act. Block identity (`id`) is preserved
 * through every transform that keeps a block being "the same block" — a paragraph turned into a
 * heading reconciles against the same model — and dropped when a block genuinely becomes another
 * thing.
 */
import type { Attrs, Node as PMNode, NodeType, Schema } from 'prosemirror-model';
import { Fragment, Slice } from 'prosemirror-model';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { blockTypeOf, COLLECTION_NODE, customNodeName, isTextNodeType } from './schema';

/** How deep a list may nest. */
export const MAX_LEVEL = 6;

/** The menu's block-type vocabulary (`BlockMenu.tsx`), resolved against the schema. */
export function menuTypeOf(node: PMNode): string {
  switch (node.type.name) {
    case 'paragraph':
      return 'p';
    case 'heading':
      return `h${node.attrs.headingLevel}`;
    case 'blockquote':
      return 'quote';
    case 'list_item':
      return node.attrs.listType === 'number' ? 'ol' : node.attrs.listType === 'check' ? 'cl' : 'ul';
    case 'unknown_block':
      return String(node.attrs.blockType);
    default:
      return blockTypeOf(node.type);
  }
}

/** The attrs a text container keeps when it changes kind. */
function carriedAttrs(node: PMNode): Attrs {
  const { id, align, direction, level } = node.attrs;
  return { id: id ?? null, align: align ?? null, direction: direction ?? null, level: level ?? 0 };
}

/** What a menu type means as a node type and attrs, or null for a custom block. */
function textTarget(schema: Schema, menuType: string, from: PMNode): { type: NodeType; attrs: Attrs } | null {
  const base = from.type.isTextblock ? carriedAttrs(from) : { id: from.attrs.id ?? null };
  switch (menuType) {
    case 'p':
      return { type: schema.nodes.paragraph, attrs: base };
    case 'h1':
    case 'h2':
    case 'h3':
      return { type: schema.nodes.heading, attrs: { ...base, headingLevel: Number(menuType.slice(1)) } };
    case 'quote':
      return { type: schema.nodes.blockquote, attrs: base };
    case 'ul':
      return { type: schema.nodes.list_item, attrs: { ...base, listType: 'bullet' } };
    case 'ol':
      return { type: schema.nodes.list_item, attrs: { ...base, listType: 'number' } };
    case 'cl':
      return { type: schema.nodes.list_item, attrs: { ...base, listType: 'check', checked: false } };
    default:
      return null;
  }
}

/**
 * Turn the block at `pos` into another kind. Text to text keeps the content and the id; text to
 * a custom block drops the text (as the menu always has — the block's own input takes over);
 * anything to a collection wraps whatever text there was in the collection's first paragraph.
 */
export function transformBlock(view: EditorView, pos: number, menuType: string): boolean {
  const { state } = view;
  const node = state.doc.nodeAt(pos);
  if (!node) return false;
  const { schema } = state;
  const end = pos + node.nodeSize;

  if (menuTypeOf(node) === menuType) return false;

  const text = textTarget(schema, menuType, node);
  let tr: Transaction;
  if (text) {
    if (node.type.isTextblock) {
      tr = state.tr.setBlockType(pos, pos + 1, text.type, text.attrs);
    } else {
      tr = state.tr.replaceWith(pos, end, text.type.create(text.attrs));
    }
    tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
  } else if (menuType === 'collection' || menuType === 'row' || menuType === 'column' || menuType === 'grid') {
    const layout = menuType === 'collection' ? 'grid' : menuType;
    const inner = node.type.isTextblock
      ? schema.nodes.paragraph.create(carriedAttrs(node), node.content)
      : schema.nodes.paragraph.create();
    const collection = schema.nodes[COLLECTION_NODE].create(
      {
        id: node.type.isTextblock ? null : (node.attrs.id ?? null),
        props: { layout, columnCount: layout === 'grid' ? 2 : 1 },
      },
      inner,
    );
    tr = state.tr.replaceWith(pos, end, collection);
    tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 2)));
  } else {
    const type = schema.nodes[customNodeName(menuType)];
    if (!type || !type.isAtom) return false;
    tr = state.tr.replaceWith(pos, end, type.create({ id: null, props: {} }));
    tr.setSelection(NodeSelection.create(tr.doc, pos));
  }
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

/** Insert nodes so the first lands at `pos` (before the block there) or after the block at `pos`. */
export function insertBlocks(view: EditorView, pos: number, nodes: PMNode[], where: 'before' | 'after'): void {
  if (!nodes.length) return;
  const { state } = view;
  const anchor = state.doc.nodeAt(pos);
  const at = where === 'before' || !anchor ? pos : pos + anchor.nodeSize;
  const tr = state.tr.insert(at, Fragment.from(nodes));
  const first = nodes[0];
  tr.setSelection(first.isTextblock ? TextSelection.near(tr.doc.resolve(at + 1)) : NodeSelection.create(tr.doc, at));
  view.dispatch(tr.scrollIntoView());
}

/** Insert a node at the selection, replacing a selected node or splitting text. */
export function insertBlockAtSelection(view: EditorView, node: PMNode): void {
  const { state } = view;
  const tr = state.tr.replaceSelectionWith(node);
  view.dispatch(tr.scrollIntoView());
}

/**
 * Move the block at `sourcePos` next to the block at `targetPos`. One transaction: delete, then
 * insert at the mapped position, so the move is one undo step and a drop into or out of a
 * collection is the same operation as a reorder.
 */
export function moveBlock(view: EditorView, sourcePos: number, targetPos: number, before: boolean): boolean {
  const { state } = view;
  const source = state.doc.nodeAt(sourcePos);
  const target = state.doc.nodeAt(targetPos);
  if (!source || !target || sourcePos === targetPos) return false;
  const sourceEnd = sourcePos + source.nodeSize;
  // Refuse to drop a collection into itself.
  if (targetPos > sourcePos && targetPos < sourceEnd) return false;

  const insertAt = before ? targetPos : targetPos + target.nodeSize;
  const tr = state.tr.delete(sourcePos, sourceEnd);
  const mapped = tr.mapping.map(insertAt, before ? -1 : 1);
  tr.insert(mapped, source);
  tr.setSelection(
    source.isTextblock ? TextSelection.near(tr.doc.resolve(mapped + 1)) : NodeSelection.create(tr.doc, mapped),
  );
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** Change the indent level of the textblock around the selection, within bounds. */
export function shiftLevel(delta: number): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    if (state.selection instanceof NodeSelection) return false;
    const node = $from.parent;
    if (!node.type.isTextblock || !$from.sameParent($to)) return false;
    const current = Number(node.attrs.level ?? 0);
    const next = Math.max(0, Math.min(MAX_LEVEL, current + delta));
    if (next === current) return false;
    if (dispatch) {
      const pos = $from.before();
      dispatch(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, level: next }));
    }
    return true;
  };
}

/** Enter inside a list item: an empty item leaves the list (or outdents); otherwise split into a fresh item. */
export const splitListItem: Command = (state, dispatch) => {
  const { $from, $to } = state.selection;
  if (state.selection instanceof NodeSelection) return false;
  const node = $from.parent;
  if (node.type.name !== 'list_item' || !$from.sameParent($to)) return false;
  const pos = $from.before();
  if (node.content.size === 0) {
    if (!dispatch) return true;
    const level = Number(node.attrs.level ?? 0);
    const tr =
      level > 0
        ? state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, level: level - 1 })
        : state.tr.setNodeMarkup(pos, state.schema.nodes.paragraph, {
            id: node.attrs.id,
            align: node.attrs.align,
            direction: node.attrs.direction,
            level: 0,
          });
    dispatch(tr.scrollIntoView());
    return true;
  }
  if (dispatch) {
    const tr = state.tr.deleteSelection();
    const attrs = { ...node.attrs, id: null, checked: false };
    tr.split(tr.mapping.map($from.pos), 1, [{ type: node.type, attrs }]);
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Backspace at the start of a list item, heading or quote turns it back into a paragraph, keeping the text. */
export const liftToParagraph: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || state.selection instanceof NodeSelection) return false;
  const node = $from.parent;
  if (!node.type.isTextblock || node.type.name === 'paragraph' || $from.parentOffset > 0) return false;
  if (dispatch) {
    const pos = $from.before();
    const { id, align, direction } = node.attrs;
    dispatch(
      state.tr.setNodeMarkup(pos, state.schema.nodes.paragraph, {
        id: id ?? null,
        align: align ?? null,
        direction: direction ?? null,
        level: 0,
      }),
    );
  }
  return true;
};

/** Enter with a block selected: a fresh paragraph after it, cursor inside. */
export const paragraphAfterSelectedNode: Command = (state, dispatch) => {
  const { selection } = state;
  if (!(selection instanceof NodeSelection)) return false;
  if (dispatch) {
    const at = selection.to;
    const tr = state.tr.insert(at, state.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, at + 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Backspace or Delete with a block selected: remove it, cursor to the neighbour. */
export const deleteSelectedNode: Command = (state, dispatch) => {
  const { selection } = state;
  if (!(selection instanceof NodeSelection)) return false;
  if (dispatch) {
    const tr = state.tr.deleteSelection();
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(selection.from, tr.doc.content.size)), -1));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Flip a check-list item's state. */
export function toggleChecked(view: EditorView, pos: number): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'list_item' || node.attrs.listType !== 'check') return false;
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !node.attrs.checked }));
  return true;
}

/** Select the block at `pos` as a unit. */
export function selectBlock(view: EditorView, pos: number, options: { focus?: boolean } = {}): void {
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;
  const tr = view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos));
  view.dispatch(tr);
  if (options.focus !== false) view.focus();
}

/** The textblock types a `Slice` of pasted or dropped blocks may contain. */
export function isTextContainer(node: PMNode): boolean {
  return isTextNodeType(node.type.name);
}

/** Nodes as a slice, for clipboard use. */
export function sliceOf(nodes: PMNode[]): Slice {
  return new Slice(Fragment.from(nodes), 0, 0);
}

export type { EditorState };
