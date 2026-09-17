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
    /*
      A form, for a paragraph that stands on its own — a line of text on a canvas. Not offered in
      "create something", for the reason a picture is not: text with nothing to belong to is written
      in a post or a note, and a canvas asks for it by name. See `recordStore.placeableEntities`.
    */
    authoring: { fields: ['text'], offered: false },
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
      /** The block's words, and the one string search, transcripts, notes and the AI all read. */
      text: { type: 'string', predicate: 'we://text', default: '', control: 'textarea' },
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
      marks: { type: 'json', predicate: 'we://marks', default: '' },
      /**
       * How this text came to be — empty for an ordinary block, and one of three words inside a
       * transcript.
       *
       * ## Why a record of a conversation has to say
       *
       * A transcript's blocks all look alike: a byline, a time, some words. That is exactly right
       * while every one of them was *said*, which was true while a transcriber was the only writer.
       * The moment somebody can type into the same timeline, or correct what the recogniser heard,
       * an unmarked block asserts something nobody checked — that these were a person's spoken
       * words — in three places at once. The panel draws it as speech; `exportCallTranscript` writes
       * it as a spoken line; and an extraction pass feeds it to a model under a prompt that says a
       * transcript is what was said out loud.
       *
       * WE already refuses this kind of quiet overstatement elsewhere: the coverage readout exists
       * so a transcript of two people out of five cannot pass as a transcript of the meeting.
       *
       * ## The three values
       *
       * - `spoken` — a recogniser heard it. The transcriber writes this and nothing else does.
       * - `typed` — a person wrote it into the transcript. Their contribution, and not a quotation.
       * - `corrected` — it was heard, and a human has since fixed the words.
       *
       * `corrected` only ever replaces `spoken`: editing something `typed` leaves it `typed`,
       * because correcting your own writing is not a correction *of a transcript*. Whoever made the
       * correction is not recorded here — editing a record does not change its author, and the
       * point of the mark is that the words are no longer verbatim, not who noticed.
       *
       * ## Why empty is the default
       *
       * Every block written by the composer is neither spoken nor typed-into-a-transcript, and the
       * question is meaningless there. Absent is the honest answer for the overwhelming majority of
       * `TextBlock`s, and it keeps every block written before this field existed correct rather than
       * retroactively claiming to be speech.
       *
       * Deliberately **not** `style`. That field looks open and is not: `serialization.ts` narrows
       * it to `h1|h2|h3|blockquote|normal`, so any other word is silently dropped on a composer
       * round-trip — and one predicate meaning two unrelated things is the mistake `we://location`
       * had to be unpicked from.
       */
      source: { type: 'string', predicate: 'we://text_source', options: ['spoken', 'typed', 'corrected'], default: '' },
      version: { type: 'number', predicate: 'we://version', default: 0 },
    },
    relations: {},
  },
};
