import type { CoreEntityDef } from './defs';

/**
 * One block of text in a composition: a paragraph, a heading, a quote, a list item.
 *
 * `text` is canonical — the one string search, transcripts, the notes module and the AI read.
 * Inline structure lives beside it in `marks`, as standoff annotations (see `@we/block-shared`'s
 * `marks.ts`): a JSON array of `{ start, end, type, ...data }` ranges over the text, offsets in
 * Unicode code points. **A block with `text` and no `marks` is one unmarked span**, so a writer
 * that knows nothing about marks — a transcriber, a plain textarea — produces a well-formed block.
 * The same holds for the structural fields: a block with only `text` is a paragraph.
 *
 * `marks` is a leaf-internal field, not a property type a shape author can reach for: nothing
 * queryable lives only in it. A mention is also written as a `we://mention` relation on the root,
 * which is where "who is named in this post" is answered.
 *
 * The structural fields are Portable Text's own vocabulary — `style`, `listItem`, `level` — with
 * `align` and `direction` as WE extensions, so the stored record and the interchange blob say the
 * same thing in the same words.
 */
export const TextBlock: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    blockable: true,
    flag: { predicate: 'we://flag', value: 'we://text_block' },
    properties: {
      /** `normal` (a paragraph), `h1` | `h2` | `h3`, or `blockquote`. */
      style: { type: 'string', predicate: 'we://style', default: 'normal' },
      /** `bullet` | `number` | `check` when the block is a list item; empty otherwise. */
      listItem: { type: 'string', predicate: 'we://list_item', default: '' },
      /** Nesting depth of a list item, or the indent of any other block. */
      level: { type: 'number', predicate: 'we://level', default: 0 },
      /** A check-list item's state. */
      checked: { type: 'boolean', predicate: 'we://checked', default: false },
      /** Alignment — `center` | `right` | `justify`; empty for the default. */
      align: { type: 'string', predicate: 'we://align', default: '' },
      /** `rtl` when set. */
      direction: { type: 'string', predicate: 'we://direction', default: '' },
      text: { type: 'string', predicate: 'we://text', default: '' },
      /** Standoff annotations over `text` — a JSON array, empty string for none. */
      marks: { type: 'json', predicate: 'we://marks', default: '' },
      version: { type: 'number', predicate: 'we://version', default: 0 },
    },
    relations: {},
  },
};
