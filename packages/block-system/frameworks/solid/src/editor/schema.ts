/**
 * The ProseMirror schema for a composition, built from the block registry.
 *
 * One document per composition. Text containers are textblocks (`paragraph`, `heading`,
 * `blockquote`, `list_item`); every registered non-text block is an atom node whose fields live in
 * a single `props` attr; a collection is a block container holding a nested composition; a mention
 * is an inline atom; and the five decorators plus the link annotations are marks. Every block node
 * carries an `id` attr — the model id once persisted — which is what makes reconciliation possible
 * without any side channel: ProseMirror keeps attrs on built-in and custom nodes alike.
 *
 * ## Lists are flat
 *
 * A list item is its own block with a `listType` and a `level`, not a child of a list container.
 * That is the shape the storage has always had (each item is one `TextBlock` with `listType` and
 * `indent`), the shape Portable Text uses (`listItem` + `level`), and the shape the block chrome
 * wants (every item has a handle). Grouping into `<ul>`/`<ol>` is a serializer's concern; here the
 * markers are CSS counters keyed on the item's attributes.
 *
 * ## The DOM spec is the renderer's too
 *
 * `toDOM` here is the *only* place the DOM shape of a text block is defined. The read-only
 * renderer serializes blocks through the same schema, so composer and renderer cannot disagree
 * about what a heading or a list item looks like — parity is structural rather than tested for.
 */
import type { CollectionContentBlock } from '@we/block-shared';
import type { DOMOutputSpec, MarkSpec, NodeSpec } from 'prosemirror-model';
import { Schema } from 'prosemirror-model';

/** Node types the schema always has, whatever is registered. */
export const TEXT_NODE_TYPES = ['paragraph', 'heading', 'blockquote', 'list_item'] as const;
export type TextNodeType = (typeof TEXT_NODE_TYPES)[number];

/** A node type name a block's `_type` becomes, and back. Custom blocks keep their registry key. */
export const COLLECTION_NODE = 'collection';
export const UNKNOWN_NODE = 'unknown_block';
export const MENTION_NODE = 'mention';

/** Attributes shared by every text container. */
const textBlockAttrs = {
  id: { default: null as string | null },
  /** Alignment — `'center'` | `'right'` | `'justify'`; null for the default. */
  format: { default: null as string | null },
  /** `'rtl'` when set. */
  direction: { default: null as string | null },
  /** Indent depth; a list item's nesting level. */
  level: { default: 0 },
};

/** The DOM attributes a text container's attrs become. */
function textBlockDomAttrs(
  attrs: Record<string, unknown>,
  extra: Record<string, string | undefined> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof attrs.format === 'string' && attrs.format) out.style = `text-align: ${attrs.format}`;
  if (attrs.direction === 'rtl') out.dir = 'rtl';
  const level = typeof attrs.level === 'number' ? attrs.level : 0;
  if (level > 0) out['data-level'] = String(level);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) out[k] = v;
  return out;
}

function readTextBlockAttrs(dom: HTMLElement): Record<string, unknown> {
  const align = dom.style?.textAlign;
  return {
    format: align && align !== 'left' && align !== 'start' ? align : null,
    direction: dom.getAttribute('dir') === 'rtl' ? 'rtl' : null,
    level: Number(dom.getAttribute('data-level') ?? 0) || 0,
  };
}

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },

  paragraph: {
    content: 'inline*',
    group: 'block',
    attrs: { ...textBlockAttrs },
    parseDOM: [{ tag: 'p', getAttrs: (dom) => readTextBlockAttrs(dom as HTMLElement) }],
    toDOM: (node) => ['p', textBlockDomAttrs(node.attrs), 0] as DOMOutputSpec,
  },

  heading: {
    content: 'inline*',
    group: 'block',
    defining: true,
    attrs: { ...textBlockAttrs, headingLevel: { default: 1 } },
    parseDOM: [1, 2, 3].map((n) => ({
      tag: `h${n}`,
      getAttrs: (dom: string | HTMLElement) => ({ ...readTextBlockAttrs(dom as HTMLElement), headingLevel: n }),
    })),
    toDOM: (node) => [`h${node.attrs.headingLevel}`, textBlockDomAttrs(node.attrs), 0] as DOMOutputSpec,
  },

  blockquote: {
    content: 'inline*',
    group: 'block',
    defining: true,
    attrs: { ...textBlockAttrs },
    parseDOM: [{ tag: 'blockquote', getAttrs: (dom) => readTextBlockAttrs(dom as HTMLElement) }],
    toDOM: (node) => ['blockquote', textBlockDomAttrs(node.attrs), 0] as DOMOutputSpec,
  },

  list_item: {
    content: 'inline*',
    group: 'block',
    defining: true,
    attrs: { ...textBlockAttrs, listType: { default: 'bullet' }, checked: { default: false } },
    parseDOM: [
      {
        tag: 'div.we-list-item',
        getAttrs: (dom) => {
          const el = dom as HTMLElement;
          return {
            ...readTextBlockAttrs(el),
            listType: el.getAttribute('data-list-type') ?? 'bullet',
            checked: el.getAttribute('data-checked') === 'true',
          };
        },
      },
      // Pasted HTML lists: each <li> becomes a flat item; nesting depth is lost on paste, which is
      // the honest reading of markup that arrives without our attributes.
      { tag: 'li', getAttrs: (dom) => ({ listType: (dom as HTMLElement).closest('ol') ? 'number' : 'bullet' }) },
    ],
    toDOM: (node) =>
      [
        'div',
        {
          class: 'we-list-item',
          ...textBlockDomAttrs(node.attrs, {
            'data-list-type': String(node.attrs.listType),
            'data-checked': node.attrs.listType === 'check' ? String(!!node.attrs.checked) : undefined,
          }),
        },
        0,
      ] as DOMOutputSpec,
  },

  [COLLECTION_NODE]: {
    content: 'block+',
    group: 'block',
    isolating: true,
    defining: true,
    selectable: true,
    attrs: { id: { default: null as string | null }, props: { default: {} as Record<string, unknown> } },
    parseDOM: [
      {
        tag: 'div[data-block-type="collection"]',
        contentElement: '.we-collection-content',
        getAttrs: (dom) => ({ props: readProps(dom as HTMLElement) }),
      },
    ],
    toDOM: (node) => {
      const props = (node.attrs.props ?? {}) as Partial<CollectionContentBlock>;
      return [
        'div',
        {
          class: 'we-block we-collection-block',
          'data-block-type': 'collection',
          'data-layout': String(props.layout ?? 'grid'),
          'data-props': JSON.stringify(props),
          style: collectionStyle(props),
        },
        ['div', { class: 'we-collection-content we-block-content' }, 0],
      ] as DOMOutputSpec;
    },
  },

  /**
   * A block whose type nothing here registered — a module the reader has not installed. It keeps
   * its fields, renders as a placeholder, and round-trips untouched, so a document is never
   * damaged by being opened on a client that lacks one of its parts.
   */
  [UNKNOWN_NODE]: {
    group: 'block',
    atom: true,
    selectable: true,
    attrs: {
      id: { default: null as string | null },
      blockType: { default: '' },
      props: { default: {} as Record<string, unknown> },
    },
    toDOM: (node) =>
      [
        'div',
        {
          class: 'we-block we-unknown-block',
          'data-block-type': String(node.attrs.blockType),
          'data-props': JSON.stringify(node.attrs.props ?? {}),
        },
        `Unsupported block: ${node.attrs.blockType}`,
      ] as DOMOutputSpec,
  },

  text: { group: 'inline' },

  hard_break: {
    inline: true,
    group: 'inline',
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM: () => ['br'] as DOMOutputSpec,
  },

  [MENTION_NODE]: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    attrs: { did: { default: '' }, text: { default: '' } },
    parseDOM: [
      {
        tag: 'span.we-mention',
        getAttrs: (dom) => ({
          did: (dom as HTMLElement).getAttribute('data-did') ?? '',
          text: (dom as HTMLElement).textContent ?? '',
        }),
      },
    ],
    toDOM: (node) =>
      ['span', { class: 'we-mention', 'data-did': String(node.attrs.did) }, String(node.attrs.text)] as DOMOutputSpec,
  },
};

const marks: Record<string, MarkSpec> = {
  strong: {
    parseDOM: [
      { tag: 'strong' },
      { tag: 'b' },
      { style: 'font-weight', getAttrs: (v) => /^(bold|[6-9]00)$/.test(String(v)) && null },
    ],
    toDOM: () => ['strong', 0] as DOMOutputSpec,
  },
  em: {
    parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }],
    toDOM: () => ['em', 0] as DOMOutputSpec,
  },
  underline: {
    parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
    toDOM: () => ['u', 0] as DOMOutputSpec,
  },
  strike: {
    parseDOM: [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration=line-through' }],
    toDOM: () => ['s', 0] as DOMOutputSpec,
  },
  code: {
    parseDOM: [{ tag: 'code' }],
    toDOM: () => ['code', 0] as DOMOutputSpec,
  },
  link: {
    attrs: { href: {} },
    inclusive: false,
    parseDOM: [
      { tag: 'a[href]:not(.we-node-link)', getAttrs: (dom) => ({ href: (dom as HTMLElement).getAttribute('href') }) },
    ],
    toDOM: (mark) =>
      ['a', { href: String(mark.attrs.href), target: '_blank', rel: 'noopener noreferrer' }, 0] as DOMOutputSpec,
  },
  nodeLink: {
    attrs: { node: {} },
    inclusive: false,
    parseDOM: [
      { tag: 'a.we-node-link', getAttrs: (dom) => ({ node: (dom as HTMLElement).getAttribute('data-node') }) },
    ],
    toDOM: (mark) => ['a', { class: 'we-node-link', 'data-node': String(mark.attrs.node) }, 0] as DOMOutputSpec,
  },
};

function readProps(dom: HTMLElement): Record<string, unknown> {
  try {
    return JSON.parse(dom.getAttribute('data-props') ?? '{}');
  } catch {
    return {};
  }
}

/** The custom properties a collection's wrapper carries for its layout CSS. */
export function collectionStyle(props: Partial<CollectionContentBlock>): string {
  const cols = props.columnCount ?? 2;
  const gap = props.gap ? `var(--we-space-${props.gap}, 1rem)` : '1rem';
  return `--we-cols: ${cols}; --we-gap: ${gap}`;
}

/** The node spec a registered custom block gets. */
function customBlockSpec(type: string): NodeSpec {
  return {
    group: 'block',
    atom: true,
    selectable: true,
    draggable: false,
    attrs: { id: { default: null as string | null }, props: { default: {} as Record<string, unknown> } },
    parseDOM: [
      { tag: `div[data-block-type="${type}"]`, getAttrs: (dom) => ({ props: readProps(dom as HTMLElement) }) },
    ],
    toDOM: (node) =>
      [
        'div',
        { class: 'we-block', 'data-block-type': type, 'data-props': JSON.stringify(node.attrs.props ?? {}) },
      ] as DOMOutputSpec,
  };
}

const RESERVED = new Set([
  'root',
  'block',
  COLLECTION_NODE,
  ...TEXT_NODE_TYPES,
  UNKNOWN_NODE,
  MENTION_NODE,
  'text',
  'hard_break',
  'doc',
]);

/**
 * Build the schema for a set of registered custom block types. Called once per composer/renderer
 * with the registry's current keys; a module registering a block after that is picked up by the
 * next one to mount.
 */
export function createBlockSchema(customTypes: readonly string[]): Schema {
  const custom: Record<string, NodeSpec> = {};
  for (const type of customTypes) {
    if (RESERVED.has(type) || custom[type]) continue;
    custom[type] = customBlockSpec(type);
  }
  return new Schema({ nodes: { ...nodes, ...custom }, marks });
}

/** Whether a schema node type is one of the text containers. */
export function isTextNodeType(name: string): name is TextNodeType {
  return (TEXT_NODE_TYPES as readonly string[]).includes(name);
}
