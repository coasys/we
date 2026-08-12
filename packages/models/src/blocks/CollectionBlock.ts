import { Flag, HasMany, HasManyMethods, Model, Property } from '@coasys/ad4m';

import { FILE_STORAGE_LANGUAGE } from '../constants';
import { WeNode } from '../WeNode';

@Model({ name: 'CollectionBlock' })
export class CollectionBlock extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://collection_block' })
  flag: string = '';

  @HasMany({ through: 'we://children' })
  children: string[] = [];

  @Property({ through: 'we://editor_state', resolveLanguage: FILE_STORAGE_LANGUAGE })
  editorState: string | null = null;

  @Property({ through: 'we://type' })
  type: string = '';

  /**
   * What this collection *is* — `'call'`, `'notes'`, later `'board'`. Semantic, and deliberately
   * separate from `type`.
   *
   * `type` is the **Lexical node type** (`root`, `collection`, …), which the serializer round-trips
   * and the editor interprets. It has been doing double duty as a discriminator — `type: 'root'`
   * currently means "is a post" — and overloading it further would put semantic values into a
   * structural field, which is the mistake the transcribe module made writing `tag: 'transcript'`
   * into `TextBlock.tag` (a field that means `ul`/`h1`).
   *
   * A scalar rather than a tag relation because this is the field you *query by*:
   * `where: { kind: 'call' }` is a native `eq` that pushes down and composes with `order`/`limit`,
   * whereas tag membership would need a reverse traversal WE does not wire up. Tags remain for user
   * taxonomy — what a thing is *about*, not what surface owns it.
   *
   * Excluded from Lexical serialization via `AD4M_ONLY_PROPS`, so it never leaks into `editorState`.
   *
   * Posts predate this field and are still identified by `type: 'root'`; the composer now also writes
   * `kind: 'post'` so new posts carry both, and the read side can switch once the legacy set stops
   * mattering. **A `CollectionBlock` with `type: 'root'` and no `kind` is a post.**
   */
  @Property({ through: 'we://kind' })
  kind: string = '';

  /**
   * Who owns this collection's children — `'document'` (one agent authored the whole artifact) or
   * `'feed'` (many agents append independently). See `CollectionMode` in `@we/block-shared`.
   *
   * The companion to `kind`, and the division of labour between them is the point: **`kind` is a
   * free label** saying what the collection is *for*, invented by whichever template needs it and
   * registered nowhere; `mode` is the one fact a consumer must know, because it is the one that
   * changes what code may do to the record. `reconcileBlocks` reads it and refuses anything not
   * `'document'` — running it on a feed deletes every child the editing agent's tree omits, which
   * is everyone else's.
   *
   * A property rather than a lookup from `kind`, and that is a peer-to-peer decision rather than a
   * modelling preference. A kind→mode registry answers differently depending on which modules the
   * *reading* client installed, so of two agents in one channel the one missing the module is
   * unprotected. Written here, the fact travels with the record and a client that has never heard
   * of the label still knows what it must not do.
   *
   * Denormalised — every channel repeats `'feed'` — which is the accepted cost of not requiring a
   * schema authority the space may never have shared with you. It is also the degenerate,
   * correctly-degrading form of shapes-in-the-space (content-models-plan stage F).
   *
   * Unset means legacy: collections written before this field existed. Treated as reconcilable,
   * since every pre-existing post is one and refusing them would break editing everywhere.
   */
  @Property({ through: 'we://mode' })
  mode: string = '';

  /**
   * What this collection is called, and what it is about — set by whoever owns it, not derived.
   *
   * On the shared model rather than per kind because they are the two pieces of metadata *every*
   * collection can have: a call, a notes collection, a board. Kind-specific state (a board's column
   * config, say) does not belong here and should not accumulate as more scalars — that is what a
   * per-kind model or a JSON bag is for.
   *
   * Scalars for the same reason `kind` is one: these are fields you query by. `where: { title:
   * { contains: … } }` pushes down to the backend and composes with `order` and `limit`, and a list
   * can sort by title. Held in `editorState` or a blob they would be invisible to all of that — and
   * a call has no `editorState` at all, since the transcribe module creates it rather than the
   * composer.
   *
   * Distinct from `textContent`, which is derived from the children for search and preview: a title
   * written there would be overwritten by the next reconcile.
   *
   * Unset costs nothing — an AD4M property is a link that exists only once written — so collections
   * that never get named carry no storage, and no migration was needed to add these.
   */
  @Property({ through: 'we://title' })
  title: string = '';

  @Property({ through: 'we://description' })
  description: string = '';

  /*
   * `display`, `columns`, `gap`, `direction`, `format` and `indent` used to sit here and were
   * removed (2026-08-12) as dead weight — a cleanup worth recording, because the shape of the
   * mistake is easy to repeat.
   *
   * They looked like a collection's layout, and they were not. `BlockRenderer` renders a document
   * purely from the `editorState` blob — it parses the serialized tree into Lexical and never reads
   * a model scalar — so the layout a user authored has always lived in the blob, and these were a
   * partial, redundant projection of it that nothing consumed.
   *
   * Two of them had never held a value at all. `extractBlockData` copies serialized-node properties
   * onto a model **by matching name**, and the Lexical collection node calls them `layout` and
   * `columnCount`, so `display` and `columns` were never written by anything. That silence is the
   * lesson: a name-matched copy makes an unused property indistinguishable from a misspelled one,
   * and neither the compiler nor a test can tell you which you have.
   *
   * What remains is deliberately two groups and no more. **Container** — `children`, `kind`, `mode`,
   * `title`, `description`, `textContent` — is true of a channel, a board, a playlist and a post
   * alike. **Document** — `editorState`, `type` — is true only of a composed artifact, and both have
   * exits: a CRDT replaces `editorState`, and `type` retires once the `kind` backfill lands.
   *
   * The rule that keeps it this size: nothing new joins the document group, and kind-specific
   * configuration — a board's column settings, the case that will push first — does not go on this
   * model at all. It waits for content-model shapes (`content-models-plan.md` stage A), which is
   * the mechanism for "this kind has these fields". Adding scalars here instead is how a universal
   * container stops being universal.
   */

  @Property({ through: 'we://version' })
  version: number = 0;

  @Property({ through: 'we://text_content' })
  textContent: string = '';
}

export interface CollectionBlock extends HasManyMethods<'children'> {}
