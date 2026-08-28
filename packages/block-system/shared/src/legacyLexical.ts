/**
 * Reads the blob format WE stored before the content layer: Lexical's serialized editor state.
 *
 * A pure JSON walk with no dependency on `lexical` — the shape is fixed in the data, and in a
 * peer-to-peer system it will be met forever: a post written in 2025 and never re-saved is still a
 * Lexical tree, and there is no coordinated moment at which every copy on every device could be
 * rewritten. So the load path accepts both shapes indefinitely and converts this one on the way in.
 * Nothing is rewritten in place; a post converges to the current form the next time its author
 * saves it, the way `kind` converged.
 *
 * What the old tree held, and where it goes:
 *
 * | Lexical                              | Content                                                  |
 * | ------------------------------------ | -------------------------------------------------------- |
 * | `paragraph` / `heading` / `quote`    | a text block with `style`                                |
 * | `list` > `listitem` (nested lists)   | one text block per item with `listItem` and `level`      |
 * | inline `text` runs with `format`     | the concatenated `text`, bitmask bits as decorator marks |
 * | `linebreak`                          | `'\n'` in the text                                       |
 * | `mention` (never produced, but read) | a `mention` mark carrying the DID                        |
 * | `collection` with `childEditorState` | a collection block with `content`                        |
 * | any other decorator node             | a custom block with the node's props as fields           |
 * | `id`                                 | `_key`                                                   |
 */
import type { ContentBlock, ListItemKind, TextContentBlock } from './content';
import { cpLength, type StandoffMark } from './marks';
import type { SerializedBlockNode } from './types';

/** Lexical `TextNode.format` bits, and the decorator each becomes. Bits with no mark are dropped. */
const FORMAT_BITS: Array<[number, string]> = [
  [1, 'strong'],
  [2, 'em'],
  [4, 'strike'],
  [8, 'underline'],
  [16, 'code'],
];

/** Fields on every Lexical node that are Lexical's own, not the block's. */
const LEXICAL_OWN = new Set([
  'type',
  'version',
  'children',
  'id',
  'direction',
  'format',
  'indent',
  'textFormat',
  'textStyle',
]);

/** Does this look like a Lexical root (or a Lexical editor-state envelope around one)? */
export function isLegacyLexicalRoot(value: unknown): value is SerializedBlockNode {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.type === 'root' && Array.isArray(v.children)) return true;
  // `{ root: {...} }` — Lexical's `editorState.toJSON()` envelope, in case one was ever stored raw.
  const root = v.root as Record<string, unknown> | undefined;
  return !!root && root.type === 'root' && Array.isArray(root.children);
}

/** Convert a Lexical root (or envelope) to content blocks. */
export function lexicalRootToContent(value: SerializedBlockNode | { root: SerializedBlockNode }): ContentBlock[] {
  const root = (
    'root' in value && value.root && typeof value.root === 'object' ? value.root : value
  ) as SerializedBlockNode;
  const out: ContentBlock[] = [];
  for (const child of root.children ?? []) convertNode(child, out, 0);
  return out;
}

function convertNode(node: SerializedBlockNode, out: ContentBlock[], level: number): void {
  switch (node.type) {
    case 'paragraph':
      out.push(textBlock(node, 'normal', level));
      return;
    case 'heading': {
      const tag = String(node.tag ?? 'h1');
      const style = tag === 'h1' || tag === 'h2' || tag === 'h3' ? tag : 'h1';
      out.push(textBlock(node, style, level));
      return;
    }
    case 'quote':
      out.push(textBlock(node, 'blockquote', level));
      return;
    case 'list':
      convertList(node, out, level);
      return;
    case 'listitem':
      // A list item outside a list is malformed; treat as a paragraph rather than lose it.
      out.push(textBlock(node, 'normal', level));
      return;
    case 'collection': {
      const { type: _t, version: _v, children: _c, id, childEditorState, ...props } = node;
      const nested = childEditorState as SerializedBlockNode | undefined;
      const content = nested && isLegacyLexicalRoot(nested) ? lexicalRootToContent(nested) : [];
      out.push({ _type: 'collection', ...(typeof id === 'string' ? { _key: id } : {}), ...props, content });
      return;
    }
    case 'root':
      for (const child of node.children ?? []) convertNode(child, out, level);
      return;
    case 'text':
    case 'linebreak':
    case 'mention':
      // Inline runs at block level — wrap them in a paragraph so nothing is lost.
      out.push(textBlock({ type: 'paragraph', children: [node] }, 'normal', level));
      return;
    default: {
      const { type, version: _v, children: _c, id, ...props } = node;
      const block: ContentBlock = { _type: type, ...(typeof id === 'string' ? { _key: id } : {}) };
      for (const [k, v] of Object.entries(props)) if (!LEXICAL_OWN.has(k) && v !== undefined) block[k] = v;
      out.push(block);
    }
  }
}

function convertList(list: SerializedBlockNode, out: ContentBlock[], level: number): void {
  const listType = String(list.listType ?? 'bullet');
  const kind: ListItemKind = listType === 'number' ? 'number' : listType === 'check' ? 'check' : 'bullet';
  for (const item of list.children ?? []) {
    if (item.type !== 'listitem') {
      convertNode(item, out, level);
      continue;
    }
    const inline = (item.children ?? []).filter((c) => c.type !== 'list');
    const nestedLists = (item.children ?? []).filter((c) => c.type === 'list');
    // Lexical's indentation plugin nests a list *inside* the previous item; an item that holds only
    // a nested list is a container, not content — emit nothing for it, recurse into the list.
    const hasContent = inline.some(
      (c) => c.type !== 'text' || (typeof c.text === 'string' && c.text.replace(/\u200B/g, '') !== ''),
    );
    if (hasContent || nestedLists.length === 0) {
      const block = textBlock({ ...item, children: inline }, 'normal', level);
      block.listItem = kind;
      if (typeof item.checked === 'boolean') block.checked = item.checked;
      out.push(block);
    }
    for (const nested of nestedLists) convertList(nested, out, level + 1);
  }
}

function textBlock(node: SerializedBlockNode, style: TextContentBlock['style'], level: number): TextContentBlock {
  const { text, marks } = inlineRuns(node.children ?? []);
  const block: TextContentBlock = { _type: 'block', style, text };
  if (typeof node.id === 'string' && node.id) block._key = node.id;
  if (marks.length) block.marks = marks;
  const indent = typeof node.indent === 'number' ? node.indent : 0;
  const effectiveLevel = level || indent;
  if (effectiveLevel > 0) block.level = effectiveLevel;
  if (typeof node.format === 'string' && node.format && node.format !== 'left') block.format = node.format;
  if (typeof node.direction === 'string' && node.direction === 'rtl') block.direction = 'rtl';
  return block;
}

/** Concatenate inline runs, turning Lexical's per-run format bits into standoff marks. */
function inlineRuns(children: SerializedBlockNode[]): { text: string; marks: StandoffMark[] } {
  let text = '';
  let offset = 0;
  const marks: StandoffMark[] = [];
  const append = (run: string, apply: (start: number, end: number) => void) => {
    const cleaned = run.replace(/\u200B/g, '');
    if (!cleaned) return;
    const length = cpLength(cleaned);
    apply(offset, offset + length);
    text += cleaned;
    offset += length;
  };
  const visit = (node: SerializedBlockNode, inherited: StandoffMark[]) => {
    switch (node.type) {
      case 'text': {
        const format = typeof node.format === 'number' ? node.format : 0;
        append(String(node.text ?? ''), (start, end) => {
          for (const [bit, type] of FORMAT_BITS) if (format & bit) marks.push({ start, end, type });
          for (const mark of inherited) marks.push({ ...mark, start, end });
        });
        return;
      }
      case 'linebreak':
        text += '\n';
        offset += 1;
        return;
      case 'mention': {
        const did = typeof node.did === 'string' ? node.did : '';
        append(String(node.text ?? ''), (start, end) => {
          if (did) marks.push({ start, end, type: 'mention', did });
          for (const mark of inherited) marks.push({ ...mark, start, end });
        });
        return;
      }
      case 'link':
      case 'autolink': {
        const href = typeof node.url === 'string' ? node.url : '';
        const link: StandoffMark[] = href ? [{ start: 0, end: 0, type: 'link', href }] : [];
        for (const child of node.children ?? []) visit(child, [...inherited, ...link]);
        return;
      }
      default:
        for (const child of node.children ?? []) visit(child, inherited);
    }
  };
  for (const child of children) visit(child, []);
  return { text, marks: mergeAdjacent(marks) };
}

/** Two runs with the same mark data back to back are one range. */
function mergeAdjacent(marks: StandoffMark[]): StandoffMark[] {
  const out: StandoffMark[] = [];
  for (const mark of marks) {
    const last = out.find((m) => m.end === mark.start && sameData(m, mark));
    if (last) last.end = mark.end;
    else out.push({ ...mark });
  }
  return out;
}

function sameData(a: StandoffMark, b: StandoffMark): boolean {
  const keysA = Object.keys(a).filter((k) => k !== 'start' && k !== 'end');
  const keysB = Object.keys(b).filter((k) => k !== 'start' && k !== 'end');
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => a[k] === b[k]);
}
