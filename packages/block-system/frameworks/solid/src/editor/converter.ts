/**
 * ProseMirror document ⇄ content blocks.
 *
 * The one editor-specific seam. Everything on the far side of it — persistence, the blob, the
 * renderer — is editor-neutral; everything on this side is ProseMirror. Text is where the work
 * is: a content block holds one string with standoff marks in **code points**, a ProseMirror
 * textblock holds text nodes with mark sets and positions in **UTF-16 units**, and a mention is a
 * mark on one side and an atom node on the other. Both directions are lossless for everything the
 * editor can express.
 */
import type { ContentBlock, ListItemKind, StandoffMark, TextContentBlock } from '@we/block-shared';
import { cpLength, isCollectionBlock, isDecorator, isTextBlock, normalizeMarks } from '@we/block-shared';
import type { Mark, Node as PMNode, Schema } from 'prosemirror-model';

import { blockTypeOf, COLLECTION_NODE, customNodeName, isTextNodeType, MENTION_NODE, UNKNOWN_NODE } from './schema';

// ── Content → ProseMirror ────────────────────────────────────────────────────

/** A whole composition as a document. An empty composition still gets the paragraph a cursor needs. */
export function contentToDoc(schema: Schema, blocks: readonly ContentBlock[]): PMNode {
  const nodes = blocksToNodes(schema, blocks);
  return schema.nodes.doc.create(null, nodes.length ? nodes : [schema.nodes.paragraph.create()]);
}

/** A list of blocks as nodes. Blocks the schema cannot represent become `unknown_block`s, never nothing. */
export function blocksToNodes(schema: Schema, blocks: readonly ContentBlock[]): PMNode[] {
  const out: PMNode[] = [];
  for (const block of blocks) {
    const node = blockToNode(schema, block);
    if (node) out.push(node);
  }
  return out;
}

/** One block as a node. */
export function blockToNode(schema: Schema, block: ContentBlock): PMNode | null {
  if (isTextBlock(block)) return textBlockToNode(schema, block);

  if (isCollectionBlock(block)) {
    const { _type: _t, _key, content, ...props } = block;
    const children = blocksToNodes(schema, content ?? []);
    return schema.nodes[COLLECTION_NODE].create(
      { id: _key ?? null, props },
      children.length ? children : [schema.nodes.paragraph.create()],
    );
  }

  const { _type, _key, ...props } = block;
  const type = schema.nodes[customNodeName(_type)];
  if (type && type.isAtom && type.name !== MENTION_NODE) return type.create({ id: _key ?? null, props });
  return schema.nodes[UNKNOWN_NODE].create({ id: _key ?? null, blockType: _type, props });
}

function textBlockToNode(schema: Schema, block: TextContentBlock): PMNode {
  const common = {
    id: block._key ?? null,
    align: block.align ?? null,
    direction: block.direction === 'rtl' ? 'rtl' : null,
    level: block.level ?? 0,
  };
  const inline = inlineContent(schema, block.text ?? '', block.marks);
  if (block.listItem) {
    return schema.nodes.list_item.create({ ...common, listType: block.listItem, checked: !!block.checked }, inline);
  }
  switch (block.style) {
    case 'h1':
    case 'h2':
    case 'h3':
      return schema.nodes.heading.create({ ...common, headingLevel: Number(block.style.slice(1)) }, inline);
    case 'blockquote':
      return schema.nodes.blockquote.create(common, inline);
    default:
      return schema.nodes.paragraph.create(common, inline);
  }
}

/**
 * Text plus standoff marks as inline nodes: text nodes carrying mark sets, `hard_break`s for
 * newlines, and a `mention` atom for each mention annotation (the text it covers becomes the
 * node's label; other marks over that stretch are dropped, since an atom cannot carry them).
 */
export function inlineContent(schema: Schema, text: string, marks: readonly StandoffMark[] | undefined): PMNode[] {
  const length = cpLength(text);
  const normalized = normalizeMarks(marks, length);
  const mentions = normalized.filter((m) => m.type === 'mention');
  const others = normalized.filter((m) => m.type !== 'mention');

  // Segment boundaries in code points: every mark edge, every newline.
  const boundaries = new Set<number>([0, length]);
  for (const mark of normalized) {
    boundaries.add(mark.start);
    boundaries.add(mark.end);
  }
  const chars = Array.from(text);
  chars.forEach((ch, i) => {
    if (ch === '\n') {
      boundaries.add(i);
      boundaries.add(i + 1);
    }
  });
  const points = [...boundaries].sort((a, b) => a - b);

  const out: PMNode[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    if (to <= from) continue;
    const segment = chars.slice(from, to).join('');
    if (segment === '\n') {
      out.push(schema.nodes.hard_break.create());
      continue;
    }
    const mention = mentions.find((m) => m.start <= from && m.end >= to);
    if (mention) {
      // One node per mention annotation, emitted at its first segment; later segments of the same
      // mention are folded into that node's label.
      const last = out[out.length - 1];
      if (last && last.type.name === MENTION_NODE && last.attrs.did === mention.did && mention.start < from) {
        out[out.length - 1] = schema.nodes[MENTION_NODE].create({ did: mention.did, text: last.attrs.text + segment });
      } else {
        out.push(schema.nodes[MENTION_NODE].create({ did: mention.did, text: segment }));
      }
      continue;
    }
    const pmMarks: Mark[] = [];
    for (const mark of others) {
      if (mark.start > from || mark.end < to) continue;
      const markType = schema.marks[mark.type];
      if (!markType) continue;
      const { start: _s, end: _e, type: _t, ...attrs } = mark;
      pmMarks.push(markType.create(attrs));
    }
    out.push(schema.text(segment, pmMarks));
  }
  return out;
}

// ── ProseMirror → content ────────────────────────────────────────────────────

/** A document as blocks. */
export function docToContent(doc: PMNode): ContentBlock[] {
  const out: ContentBlock[] = [];
  doc.forEach((node) => {
    const block = nodeToBlock(node);
    if (block) out.push(block);
  });
  return out;
}

/** One block-level node as a block. */
export function nodeToBlock(node: PMNode): ContentBlock | null {
  const name = node.type.name;
  if (isTextNodeType(name)) return textNodeToBlock(node);

  if (name === COLLECTION_NODE) {
    const content: ContentBlock[] = [];
    node.forEach((child) => {
      const block = nodeToBlock(child);
      if (block) content.push(block);
    });
    return {
      _type: 'collection',
      ...(node.attrs.id ? { _key: node.attrs.id } : {}),
      ...(node.attrs.props as Record<string, unknown>),
      content,
    };
  }

  if (name === UNKNOWN_NODE) {
    return {
      _type: String(node.attrs.blockType),
      ...(node.attrs.id ? { _key: node.attrs.id } : {}),
      ...(node.attrs.props as Record<string, unknown>),
    };
  }

  if (node.type.isAtom) {
    return {
      _type: blockTypeOf(node.type),
      ...(node.attrs.id ? { _key: node.attrs.id } : {}),
      ...(node.attrs.props as Record<string, unknown>),
    };
  }
  return null;
}

function textNodeToBlock(node: PMNode): TextContentBlock {
  const { text, marks } = inlineToStandoff(node);
  const block: TextContentBlock = { _type: 'block', text };
  if (node.attrs.id) block._key = node.attrs.id;
  switch (node.type.name) {
    case 'heading':
      block.style = `h${node.attrs.headingLevel}` as TextContentBlock['style'];
      break;
    case 'blockquote':
      block.style = 'blockquote';
      break;
    case 'list_item':
      block.style = 'normal';
      block.listItem = node.attrs.listType as ListItemKind;
      if (node.attrs.checked) block.checked = true;
      break;
    default:
      block.style = 'normal';
  }
  if (typeof node.attrs.level === 'number' && node.attrs.level > 0) block.level = node.attrs.level;
  if (typeof node.attrs.align === 'string' && node.attrs.align) block.align = node.attrs.align;
  if (node.attrs.direction === 'rtl') block.direction = 'rtl';
  if (marks.length) block.marks = marks;
  return block;
}

/** A textblock's inline content as text plus standoff marks, offsets in code points. */
export function inlineToStandoff(node: PMNode): { text: string; marks: StandoffMark[] } {
  let text = '';
  let offset = 0;
  const marks: StandoffMark[] = [];
  /** Ranges still open, keyed by the mark's identity so adjacent text nodes merge. */
  const open = new Map<string, StandoffMark>();

  const closeExcept = (keep: Set<string>) => {
    for (const [key, range] of [...open]) {
      if (!keep.has(key)) {
        marks.push(range);
        open.delete(key);
      }
    }
  };

  node.forEach((child) => {
    if (child.isText) {
      const run = child.text ?? '';
      const length = cpLength(run);
      const keep = new Set<string>();
      for (const mark of child.marks) {
        const key = markKey(mark);
        keep.add(key);
        const existing = open.get(key);
        if (existing) existing.end = offset + length;
        else open.set(key, { start: offset, end: offset + length, type: mark.type.name, ...mark.attrs });
      }
      closeExcept(keep);
      text += run;
      offset += length;
      return;
    }
    closeExcept(new Set());
    if (child.type.name === 'hard_break') {
      text += '\n';
      offset += 1;
      return;
    }
    if (child.type.name === MENTION_NODE) {
      const label = String(child.attrs.text ?? '');
      const length = cpLength(label);
      if (child.attrs.did)
        marks.push({ start: offset, end: offset + length, type: 'mention', did: String(child.attrs.did) });
      text += label;
      offset += length;
    }
  });
  closeExcept(new Set());
  return { text, marks: normalizeMarks(marks, offset) };
}

function markKey(mark: Mark): string {
  return isDecorator(mark.type.name) ? mark.type.name : `${mark.type.name}:${JSON.stringify(mark.attrs)}`;
}
