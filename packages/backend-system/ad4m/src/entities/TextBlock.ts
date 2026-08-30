/**
 * GENERATED from src/manifest/TextBlock.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/entities generate:classes` after changing it.
 */
import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from './WeNode';

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
@Model({ name: 'TextBlock' })
export class TextBlock extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://text_block' })
  flag: string = '';

  /** `normal` (a paragraph), `h1` | `h2` | `h3`, or `blockquote`. */
  @Property({ through: 'we://style' })
  style: string = 'normal';

  /** `bullet` | `number` | `check` when the block is a list item; empty otherwise. */
  @Property({ through: 'we://list_item' })
  listItem: string = '';

  /** Nesting depth of a list item, or the indent of any other block. */
  @Property({ through: 'we://level' })
  level: number = 0;

  /** A check-list item's state. */
  @Property({ through: 'we://checked' })
  checked: boolean = false;

  /** Alignment — `center` | `right` | `justify`; empty for the default. */
  @Property({ through: 'we://align' })
  align: string = '';

  /** `rtl` when set. */
  @Property({ through: 'we://direction' })
  direction: string = '';

  /** The block's words, and the one string search, transcripts, notes and the AI all read. */
  @Property({ through: 'we://text' })
  text: string = '';

  /**
   * Inline structure over `text`, as standoff annotations — a JSON array of
   * `{ start, end, type, ...data }` ranges, offsets in Unicode **code points**, empty string for
   * none. Types are `strong`, `em`, `underline`, `strike`, `code`, `link` (with `href`),
   * `nodeLink` and `mention` (with `did`).
   *
   * A block with `text` and no `marks` is one unmarked span, which is what makes a writer that
   * knows nothing about marks — a transcriber, a plain textarea — produce a well-formed block.
   *
   * Read it to *render* text; do not query on it. Anything queryable is written out as a
   * relation beside it: a mention is also a `we://mention` link on the root, which is where
   * "who is named in this post" is answered.
   */
  @Property({ through: 'we://marks' })
  marks: string = '';

  @Property({ through: 'we://version' })
  version: number = 0;
}
