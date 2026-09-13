import type { CoreEntityDef } from './defs';

export const CollectionBlock: CoreEntityDef = {
  base: 'WeNode',
  methodRelations: ['children', 'arranges'],
  entity: {
    blockable: true,
    flag: { predicate: 'we://flag', value: 'we://collection_block' },
    /*
      How a collection reads when something shows one — a card on a canvas, an inspector, the
      record page. Manifest-side prose: `display` is a hint for whatever draws a record and has no
      counterpart on the generated class, so it is not lifted into one.

      It carries no `authoring`, and correctly: nobody types a document into a field list, so the
      composer makes these and no generated form should offer to. But `authoring` was also the only
      thing `displayFor` had to work from, so "cannot be typed in" silently meant "cannot be shown",
      and a note selected on a canvas opened an inspector with nothing in it at all — no name, no
      description, not even its own type. The two questions are separate, which is what this half of
      the declaration is for.

      Roles, and deliberately no `fields`. The two are separate halves: the roles say which property
      is the name and which the one-line summary — worth knowing for a *container*, since a call, a
      channel and a board column all carry a title somebody chose — while `fields` is the list a
      surface enumerates, and there is no list here worth enumerating. Everything else on this class
      is machinery (the structural `type`, the `kind` label, `mode`, `version`, and `textContent`,
      which is a projection of the children for search), and a note has nothing to say in a field at
      all: its substance is its children, read through the composer, and its name is their first
      line. Declaring the two properties as a list made an inspector offer to *name a sticky note*,
      which is a question nobody has.

      So: a container shows its title and description where it has them, and a composed document
      shows neither and is not asked for either.
    */
    display: { title: 'title', summary: 'description' },
    properties: {
      editorState: { type: 'string', predicate: 'we://editor_state', format: 'file', default: null },
      /**
       * The **structural** node type — `root` for a composition, `collection` for a nested one — which
       * the serializer round-trips.
       *
       * Semantic values do not belong here; that is `kind`. Boards briefly marked which one was
       * canonical with `type: 'space'` and `type: 'anchor'`, which is the mistake this field's own
       * documentation names (see `kind`, and the transcribe module writing `tag: 'transcript'` into
       * `TextBlock.style`). It is a relation now — `CollectionBlock.board` and `Space.board` — which
       * also converges where a marker could not.
       */
      type: { type: 'string', predicate: 'we://type', default: '' },
      /**
       * What this collection *is* — `'call'`, `'notes'`, later `'board'`. Semantic, and deliberately
       * separate from `type`.
       *
       * `type` is the **structural node type** (`root` for a composition, `collection` for a nested
       * one), which the serializer round-trips. It has been doing double duty as a discriminator — `type: 'root'`
       * currently means "is a post" — and overloading it further would put semantic values into a
       * structural field, which is the mistake the transcribe module made writing `tag: 'transcript'`
       * into `TextBlock.style` (a field that means `h1`/`blockquote`).
       *
       * A scalar rather than a tag relation because this is the field you *query by*:
       * `where: { kind: 'call' }` is a native `eq` that pushes down and composes with `order`/`limit`,
       * whereas tag membership would need a reverse traversal WE does not wire up. Tags remain for user
       * taxonomy — what a thing is *about*, not what surface owns it.
       *
       * Never written into `editorState`: the blob is a projection of the children, and `kind` is a
       * fact about the collection, not its content.
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
      /**
       * The vocabulary term this collection stands *for*, where it stands for one.
       *
       * A board's column is the case it exists for: a column bound to `todo` shows the work whose
       * `status` is `todo`, so the column is a saved query as much as a container — `arranges` is
       * the order somebody put those cards in, and this is what decides which cards they are.
       * Empty means the collection stands for nothing, which for a column is a **local lane**:
       * "Thursday", "Waiting on Ana". Nothing arrives in one on its own, and dropping a card there
       * says nothing about the work — which is exactly what a lane claiming no shared meaning
       * should do.
       *
       * A slug rather than a link to the `TaskState` record, for the reason `TaskBlock.status` holds
       * one: the vocabulary is a naming of values that already exist, so a column keeps working when
       * a state is retired, and a task whose state nothing recognises can still be found and moved.
       *
       * Its own field rather than more meaning on `type`, which is already the post discriminator
       * and was explicitly not to accumulate a third reading.
       */
      slug: { type: 'string', predicate: 'we://slug', default: '' },
      description: { type: 'string', predicate: 'we://description', default: '' },
      version: { type: 'number', predicate: 'we://version', default: 0 },
      textContent: { type: 'string', predicate: 'we://text_content', default: '' },
    },
    relations: {
      /**
       * What is in this collection, in the order somebody put it there.
       *
       * `ordered` because the sequence is authored: a person dragged the image above the paragraph,
       * and reading the blocks back in a different order does not show them a differently-sorted
       * post, it shows them a different post. Until it was declared, the order held only by accident
       * — a save rewrote every child link, so their timestamps came out in array order and reading
       * by timestamp looked like reading the author's sequence. That accident survives one editor
       * and not two.
       *
       * The target is empty because a collection holds text, images, tasks, further collections and
       * whatever a community has since defined — which also makes it polymorphic by default, so
       * each child is read as the class it actually is rather than as a bare reference.
       *
       * **This is ownership.** Everything that walks a collection — deleting it, reconciling an
       * edit, opening it in the graph — follows `children` and treats what it finds as the
       * collection's own. A board's columns are its children for exactly that reason: deleting the
       * board should take them. The cards a column *positions* are not, which is what `arranges`
       * is for.
       */
      children: { target: '', cardinality: 'many', predicate: 'we://children', ordered: true },
      /**
       * Records this collection **arranges without owning** — a board column's cards, in the order
       * somebody dragged them into.
       *
       * Its own relation rather than more meaning on `children`, because the two are different
       * facts and every walker in the codebase reads `children` as the first one. `deleteBlocks`
       * recurses through it, `reconcileBlocks` diffs against it, the graph's collection expander
       * opens it, and an `include` on a call returns it. Had a column's cards sat there, deleting a
       * call whose board held a card from elsewhere would have deleted that card; and the only thing
       * saying "these children are not owned" would have been `kind: 'column'`, which is a free
       * label registered nowhere — the lookup-by-label this class's own `mode` docblock refuses. A
       * fact that changes what code may do to a record travels with the record, or here, with the
       * link.
       *
       * `ordered` for the same reason `children` is, and it is the reason a column is a record at
       * all: an ordered relation is a conflict-free sequence in the backend, so two people arranging
       * one column at the same moment converge. Untyped, because a column can arrange whatever a
       * board is about — tasks today, and any record with a state field or none tomorrow.
       *
       * A board carries it too, for what it holds in **no column**: a card whose lane was deleted
       * stays on the board through this until a column claims it. Membership of a made board is the
       * union of these across the board and its columns; see `docs/architecture/boards.md`.
       */
      arranges: { target: '', cardinality: 'many', predicate: 'we://arranges', ordered: true },
      /**
       * What this board draws its work from, where it draws any: the Space record for the space's
       * own board, a container's record for that container's board. Empty means the board shows
       * only what somebody put on it.
       *
       * On the board rather than inferred from which container points at it, because that inference
       * was made by every surface that rendered a board and had to be made correctly each time — a
       * view compared the open board against `Space.board` and the anchor's `board`, a template
       * passed a literal, and a third surface would have had to learn the rule or silently shown
       * everything or nothing. A board that knows what it gathers can be rendered by anything that
       * has its id.
       *
       * Distinct from `CollectionBlock.board` / `Space.board`, which say which board is the
       * container's **canonical** one. Those stay single-valued links because two boards claiming
       * to be *the* one is a race that has to converge; two boards both gathering from the same
       * container is merely two boards showing the same work, which is harmless and occasionally
       * wanted. Untyped, since the two things it can name are a Space and a CollectionBlock.
       */
      gathers: { target: '', cardinality: 'one', predicate: 'we://gathers' },
      /**
       * The board this collection's work is arranged on — the canonical one, where it has several.
       *
       * A fact about the **collection**, not about the board: "the board for this call" is something
       * the call knows, the way `taskStates` is something a space knows. Declared rather than marked
       * with a value on the board, because a marker cannot stop two boards claiming to be the one —
       * two members pressing the button at the same moment on two nodes would produce two — where a
       * single-valued link converges and the loser is simply an ordinary board in the list.
       *
       * Distinct from being *in* `children`. A call may hold any number of boards, all of them its
       * children and all listed together; this says which of them extraction lands on and which
       * gathers the call's work rather than only holding what somebody put there.
       */
      board: { target: 'CollectionBlock', cardinality: 'one', predicate: 'we://board' },
      /**
       * Every time a model was asked to read this collection — see {@link ExtractionPass}.
       *
       * Its own relation rather than `children`, which holds a collection's *content*: a pass is a
       * fact about the collection, not something in it, and in `children` it would be loaded by the
       * board and drawn as a card.
       */
      extractionPasses: {
        target: 'ExtractionPass',
        cardinality: 'many',
        predicate: 'we://extraction_pass_record',
      },
      /**
       * What a model wrote from reading this collection — the provenance of an extracted record.
       *
       * ## Why this is not a subset of `children` doing double duty
       *
       * Everything a pass writes *is* also a child, and must stay one: `children` is ownership, and
       * the call's board gathers through it, so a task that stopped being a child would vanish from
       * the board it exists to appear on. This says something else about the same record — that
       * nobody typed it, a model proposed it from the conversation — and that is a different fact,
       * not a narrower spelling of the first. The same split `arranges` makes one level over.
       *
       * It is also the *true* question a review surface asks. "Which children are tasks" and "which
       * children came from a pass" answer differently the moment somebody composes a task into a
       * call by hand: the first counts it as extracted, the second does not.
       *
       * ## Why a link rather than a field on the record
       *
       * A property saying which call produced it would be unreadable in one query. An `include` on
       * the call traverses *relations*, so provenance has to be a relation for "everything this call
       * produced" to come back polymorphically in one round trip. Through `children` that question
       * cannot be asked at all: an untyped include is all-or-nothing and carries no class
       * constraint, so it would return every utterance in the transcript alongside the handful of
       * records — which is why the panel had one subscription per model before this existed.
       *
       * Untyped, and deliberately: a pass writes whatever the space has said it may write, which
       * includes shapes a community defined this morning. Unordered, because the sequence that
       * matters is when each record was made and `createdAt` already says that — where `children`
       * is ordered because somebody arranged it.
       */
      extracted: { target: '', cardinality: 'many', predicate: 'we://extracted' },
    },
  },
};
