import type { CoreEntityDef } from '../defs';

export const CollectionBlock: CoreEntityDef = {
  base: 'WeNode',
  methodRelations: ['children'],
  // Genuinely absent rather than zero: a card at the origin and a collection that was never on a
  // board are different things, and defaulting them to 0 would place every post at the top-left of
  // every board it was ever dragged onto.
  optional: ['x', 'y'],
  entity: {
    flag: { predicate: 'we://flag', value: 'we://collection_block' },
    properties: {
      editorState: { type: 'string', predicate: 'we://editor_state', format: 'file', default: null },
      type: { type: 'string', predicate: 'we://type', default: '' },
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
      kind: { type: 'string', predicate: 'we://kind', default: '' },
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
      mode: { type: 'string', predicate: 'we://mode', default: '' },
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
      title: { type: 'string', predicate: 'we://title', default: '' },
      description: { type: 'string', predicate: 'we://description', default: '' },
      version: { type: 'number', predicate: 'we://version', default: 0 },
      textContent: { type: 'string', predicate: 'we://text_content', default: '' },
      /*
        Where this sits on a board.

        The one case where position *is* the content rather than a derivation of it. Everywhere else
        WE renders — a feed, a channel, a calendar — arrangement comes from the data: order by date,
        group by kind, lay out by containment. A board is the surface where somebody put a thing
        somewhere because that is what they meant, and nothing else in the record can carry that.

        On the shared model rather than on a `Placement` record pointing at a card, which was the
        other candidate. A placement record would let *anything* be placed on a board and let one
        record appear on several, both of which are real; it also means a board's contents are not
        its children, so nothing that already walks a collection would find them, and two records
        have to be created, kept in step, and cleaned up together for every card. A collection is
        already WE's container and `kind` already anticipates a board — this is the smaller change
        by a long way, and the general form remains reachable later without moving any of it.

        Unset on everything that is not on a board, which costs nothing: an AD4M property is a link
        that exists only once written, so a post carries no x and no y and no migration was needed.
      */
      x: { type: 'number', predicate: 'we://x' },
      y: { type: 'number', predicate: 'we://y' },
    },
    relations: {
      children: { target: '', cardinality: 'many', predicate: 'we://children' },
    },
  },
};
