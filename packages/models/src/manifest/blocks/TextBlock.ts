import type { CoreEntityDef } from '../defs';

/**
 * One block of text in a composition: a paragraph, a heading, a quote, a list item.
 *
 * `text` is canonical — the one string search, transcripts, the notes module and the AI read.
 * Inline structure lives beside it in `marks`, as standoff annotations (see `@we/block-shared`'s
 * `marks.ts`): a JSON array of `{ start, end, type, ...data }` ranges over the text, offsets in
 * Unicode code points. **A block with `text` and no `marks` is one unmarked span**, so a writer
 * that knows nothing about marks — a transcriber, a plain textarea — produces a well-formed block.
 *
 * `marks` is a leaf-internal field, not a property type a shape author can reach for: nothing
 * queryable lives only in it. A mention is also written as a `we://mention` relation on the root,
 * which is where "who is named in this post" is answered.
 *
 * `type`/`tag`/`listType`/`indent` carry the block's structural role in the vocabulary the field
 * has always had (`paragraph`, `heading` + `h2`, `listitem` + `bullet` + `1`), so readers written
 * against old records keep reading new ones. `format` is alignment; `direction` is `rtl` when set.
 */
export const TextBlock: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    flag: { predicate: 'we://flag', value: 'we://text_block' },
    properties: {
      type: { type: 'string', predicate: 'we://type', default: '' },
      direction: { type: 'string', predicate: 'we://direction', default: '' },
      format: { type: 'string', predicate: 'we://format', default: '' },
      indent: { type: 'number', predicate: 'we://indent', default: 0 },
      textFormat: { type: 'number', predicate: 'we://textFormat', default: 0 },
      textStyle: { type: 'string', predicate: 'we://textStyle', default: '' },
      listType: { type: 'string', predicate: 'we://listType', default: '' },
      start: { type: 'number', predicate: 'we://start', default: 0 },
      tag: { type: 'string', predicate: 'we://tag', default: '' },
      text: { type: 'string', predicate: 'we://text', default: '' },
      /** Standoff annotations over `text` — a JSON array, empty string for none. */
      marks: { type: 'json', predicate: 'we://marks', default: '' },
      /** A check-list item's state. */
      checked: { type: 'boolean', predicate: 'we://checked', default: false },
      version: { type: 'number', predicate: 'we://version', default: 0 },
    },
    relations: {},
  },
};
