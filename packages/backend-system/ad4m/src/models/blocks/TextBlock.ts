/**
 * GENERATED from src/manifest/blocks/TextBlock.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/models generate:classes` after changing it.
 */
import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

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
@Model({ name: 'TextBlock' })
export class TextBlock extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://text_block' })
  flag: string = '';

  @Property({ through: 'we://type' })
  type: string = '';

  @Property({ through: 'we://direction' })
  direction: string = '';

  @Property({ through: 'we://format' })
  format: string = '';

  @Property({ through: 'we://indent' })
  indent: number = 0;

  @Property({ through: 'we://textFormat' })
  textFormat: number = 0;

  @Property({ through: 'we://textStyle' })
  textStyle: string = '';

  @Property({ through: 'we://listType' })
  listType: string = '';

  @Property({ through: 'we://start' })
  start: number = 0;

  @Property({ through: 'we://tag' })
  tag: string = '';

  @Property({ through: 'we://text' })
  text: string = '';

  /** Standoff annotations over `text` — a JSON array, empty string for none. */
  @Property({ through: 'we://marks' })
  marks: string = '';

  /** A check-list item's state. */
  @Property({ through: 'we://checked' })
  checked: boolean = false;

  @Property({ through: 'we://version' })
  version: number = 0;
}
