/**
 * The content model — what a composition *is*, independent of any editor.
 *
 * A composition is an ordered list of blocks. A text block is a canonical string plus standoff
 * marks (see `marks.ts`); every other block is a typed record whose fields are its model's
 * properties; a collection is a block that holds a composition of its own. This is the shape the
 * editor converts to and from, the shape persistence writes as models, and — with spans derived
 * (see {@link toPortableText}) — the shape stored in the per-post blob.
 *
 * It is deliberately **conformant Portable Text with WE extensions**: `_type`/`_key` are Portable
 * Text's names, a text block is `_type: 'block'` with `style`/`listItem`/`level`, and a custom block
 * is any other `_type`. A Portable Text consumer reads `children`; a WE reader reads `text`/`marks`;
 * neither converts. The extension fields (`text`, `marks`, `format`, `direction`, `checked`, and a
 * collection's `content`) are legal — a Portable Text block is an open object.
 *
 * Content is **data, never evaluated**: nothing in here is an expression, and the renderer draws
 * strings. A post from a stranger crosses no trust boundary because it can carry no code.
 */
import { cpLength, isDecorator, normalizeMarks, type StandoffMark } from './marks';

/** The text-block styles the editor offers. `normal` is a paragraph. */
export type BlockStyle = 'normal' | 'h1' | 'h2' | 'h3' | 'blockquote';

/** What kind of list an item belongs to. */
export type ListItemKind = 'bullet' | 'number' | 'check';

export interface TextContentBlock {
  _type: 'block';
  /** The block's id once persisted — the `TextBlock` model id. Absent on a block not yet saved. */
  _key?: string;
  style?: BlockStyle;
  listItem?: ListItemKind;
  /** Nesting depth for a list item (0 = top level), or an indent for any other block. */
  level?: number;
  /** A check-list item's state. */
  checked?: boolean;
  /** Alignment — `'center'`, `'right'`, `'justify'`; absent for the default. A WE extension. */
  format?: string;
  /** Writing direction, when it matters — `'ltr'` | `'rtl'`. A WE extension. */
  direction?: string;
  /** The canonical string. `'\n'` is a soft line break. */
  text: string;
  /** Standoff annotations over `text`, offsets in code points. Absent means none. */
  marks?: StandoffMark[];
  /** Portable Text spans — derived from `text` + `marks` by {@link toPortableText}. Never authored. */
  children?: PortableTextSpan[];
  /** Portable Text annotation definitions the spans reference — derived alongside `children`. */
  markDefs?: PortableTextMarkDef[];
}

/** Any block that is not text: its `_type` is the block registry's node type, its fields its model's. */
export interface CustomContentBlock {
  _type: string;
  _key?: string;
  [field: string]: unknown;
}

/** A nested composition with a layout of its own. */
export interface CollectionContentBlock extends CustomContentBlock {
  _type: 'collection';
  layout?: string;
  columnCount?: number;
  gap?: string;
  content: ContentBlock[];
}

export type ContentBlock = TextContentBlock | CustomContentBlock;

/**
 * What the composer hands to a save. The blocks, plus — for an edit — the keys of every block that
 * was loaded, so the save can tell "removed by the author" from "added by somebody else while the
 * author was editing" (see `reconcileBlocks`). Never stored: the blob is the bare array.
 */
export interface ContentDocument {
  _type: 'document';
  blocks: ContentBlock[];
  base?: string[];
}

export interface PortableTextSpan {
  _type: 'span';
  _key: string;
  text: string;
  /** Decorator names, and the `_key`s of `markDefs` entries. */
  marks: string[];
}

export interface PortableTextMarkDef {
  _key: string;
  _type: string;
  [data: string]: unknown;
}

// ── Type guards ──────────────────────────────────────────────────────────────

export function isTextBlock(block: ContentBlock | null | undefined): block is TextContentBlock {
  return !!block && block._type === 'block';
}

export function isCollectionBlock(block: ContentBlock | null | undefined): block is CollectionContentBlock {
  return !!block && block._type === 'collection';
}

export function isContentDocument(value: unknown): value is ContentDocument {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as ContentDocument)._type === 'document' &&
    Array.isArray((value as ContentDocument).blocks)
  );
}

export function isContentBlockArray(value: unknown): value is ContentBlock[] {
  return Array.isArray(value) && value.every((b) => typeof b === 'object' && b !== null && typeof b._type === 'string');
}

/** A fresh, empty composition: the one paragraph a cursor needs. */
export function emptyContent(): ContentBlock[] {
  return [{ _type: 'block', style: 'normal', text: '' }];
}

// ── Walking ──────────────────────────────────────────────────────────────────

/** Visit every block, depth first, nested collections included. */
export function walkBlocks(blocks: readonly ContentBlock[], visit: (block: ContentBlock, depth: number) => void): void {
  const walk = (list: readonly ContentBlock[], depth: number) => {
    for (const block of list) {
      visit(block, depth);
      if (isCollectionBlock(block) && Array.isArray(block.content)) walk(block.content, depth + 1);
    }
  };
  walk(blocks, 0);
}

/** Every `_key` in the composition, nested included, in document order. */
export function collectKeys(blocks: readonly ContentBlock[]): string[] {
  const keys: string[] = [];
  walkBlocks(blocks, (b) => {
    if (typeof b._key === 'string' && b._key) keys.push(b._key);
  });
  return keys;
}

/** Map every block to a new one, recursing into collections. Structural, not mutating. */
export function mapBlocks(blocks: readonly ContentBlock[], fn: (block: ContentBlock) => ContentBlock): ContentBlock[] {
  return blocks.map((block) => {
    const mapped = fn(block);
    if (isCollectionBlock(mapped) && Array.isArray(mapped.content)) {
      return { ...mapped, content: mapBlocks(mapped.content, fn) };
    }
    return mapped;
  });
}

// ── Portable Text projection ─────────────────────────────────────────────────

/**
 * Derive Portable Text spans and mark definitions from a block's `text` and `marks`.
 *
 * Boundaries are every mark start and end; each segment between them is one span carrying the
 * decorators that cover it and the keys of the annotations that do. Span keys are positional and
 * promise nothing across saves — block keys are the stable ones.
 */
export function spansFromStandoff(
  text: string,
  marks: readonly StandoffMark[] | undefined,
): { children: PortableTextSpan[]; markDefs: PortableTextMarkDef[] } {
  const length = cpLength(text);
  const normalized = normalizeMarks(marks, length);
  const markDefs: PortableTextMarkDef[] = [];
  const annotationKey = new Map<StandoffMark, string>();
  for (const mark of normalized) {
    if (isDecorator(mark.type)) continue;
    const { start: _s, end: _e, type, ...data } = mark;
    const key = `m${markDefs.length + 1}`;
    markDefs.push({ _key: key, _type: type, ...data });
    annotationKey.set(mark, key);
  }

  const boundaries = new Set<number>([0, length]);
  for (const mark of normalized) {
    boundaries.add(mark.start);
    boundaries.add(mark.end);
  }
  const points = [...boundaries].sort((a, b) => a - b);
  const chars = Array.from(text);
  const children: PortableTextSpan[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    if (to <= from) continue;
    const covering: string[] = [];
    for (const mark of normalized) {
      if (mark.start <= from && mark.end >= to) covering.push(annotationKey.get(mark) ?? mark.type);
    }
    children.push({
      _type: 'span',
      _key: `s${children.length + 1}`,
      text: chars.slice(from, to).join(''),
      marks: covering,
    });
  }
  if (children.length === 0) children.push({ _type: 'span', _key: 's1', text: '', marks: [] });
  return { children, markDefs };
}

/** The inverse of {@link spansFromStandoff}, for content a Portable Text producer wrote spans-only. */
export function standoffFromSpans(
  children: readonly PortableTextSpan[] | undefined,
  markDefs: readonly PortableTextMarkDef[] | undefined,
): { text: string; marks: StandoffMark[] } {
  const defs = new Map<string, PortableTextMarkDef>();
  for (const def of markDefs ?? []) defs.set(def._key, def);
  // Open ranges per mark name, so adjacent spans with the same mark merge into one range.
  const open = new Map<string, StandoffMark>();
  const marks: StandoffMark[] = [];
  let text = '';
  let offset = 0;
  for (const span of children ?? []) {
    if (!span || span._type !== 'span') continue;
    const spanText = typeof span.text === 'string' ? span.text : '';
    const spanMarks = new Set(Array.isArray(span.marks) ? span.marks : []);
    const length = cpLength(spanText);
    // Close any open range this span does not continue.
    for (const [name, range] of [...open]) {
      if (!spanMarks.has(name)) {
        marks.push(range);
        open.delete(name);
      }
    }
    for (const name of spanMarks) {
      const existing = open.get(name);
      if (existing) {
        existing.end = offset + length;
        continue;
      }
      const def = defs.get(name);
      const { _key: _k, _type, ...data } = def ?? { _key: name, _type: name };
      open.set(name, { start: offset, end: offset + length, type: def ? _type : name, ...data });
    }
    text += spanText;
    offset += length;
  }
  for (const range of open.values()) marks.push(range);
  return { text, marks: normalizeMarks(marks, offset) };
}

/**
 * The stored/interchange form: every text block carries derived `children` and `markDefs` beside
 * its canonical `text`/`marks`, every block carries a `_key` (a positional one when unsaved), and
 * nested collections are projected in place.
 */
export function toPortableText(blocks: readonly ContentBlock[]): ContentBlock[] {
  return blocks.map((block, index) => {
    const key = typeof block._key === 'string' && block._key ? block._key : `b${index + 1}`;
    if (isTextBlock(block)) {
      const { children: _c, markDefs: _m, ...rest } = block;
      const marks = normalizeMarks(block.marks, cpLength(block.text ?? ''));
      const projected = spansFromStandoff(block.text ?? '', marks);
      return {
        ...rest,
        _key: key,
        style: block.style ?? 'normal',
        text: block.text ?? '',
        ...(marks.length ? { marks } : {}),
        children: projected.children,
        markDefs: projected.markDefs,
      } as TextContentBlock;
    }
    if (isCollectionBlock(block)) {
      return { ...block, _key: key, content: toPortableText(block.content ?? []) };
    }
    return { ...block, _key: key };
  });
}

/**
 * Read a Portable Text array back into the lean in-memory form: `text`/`marks` canonical (derived
 * from spans when a producer wrote only those), no derived fields carried along.
 */
export function fromPortableText(blocks: readonly ContentBlock[]): ContentBlock[] {
  return blocks.map((block) => {
    if (isTextBlock(block)) {
      const { children, markDefs, ...rest } = block;
      const hasText = typeof block.text === 'string';
      const derived = hasText ? null : standoffFromSpans(children, markDefs);
      const text = hasText ? block.text : (derived?.text ?? '');
      const marks = hasText ? normalizeMarks(block.marks, cpLength(text)) : (derived?.marks ?? []);
      const out: TextContentBlock = { ...rest, text };
      if (marks.length) out.marks = marks;
      else delete out.marks;
      return out;
    }
    if (isCollectionBlock(block)) {
      return { ...block, content: fromPortableText(Array.isArray(block.content) ? block.content : []) };
    }
    return { ...block };
  });
}

/**
 * Plain text of a composition, one line per block, for previews and the AI. Not the search index
 * — that is `extractTextContent` in `serialization.ts`, which knows each custom block's text fields.
 */
export function plainText(blocks: readonly ContentBlock[]): string {
  const lines: string[] = [];
  walkBlocks(blocks, (b) => {
    if (isTextBlock(b) && b.text) lines.push(b.text);
  });
  return lines.join('\n');
}
