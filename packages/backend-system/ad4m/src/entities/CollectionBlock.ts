/**
 * GENERATED from src/manifest/CollectionBlock.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/entities generate:classes` after changing it.
 */
import { Flag, HasMany, HasManyMethods, HasOne, Model, Property } from '@coasys/ad4m';
import { FILE_STORAGE_LANGUAGE } from '@we/entities';

import { ExtractionAmendment } from './ExtractionAmendment';
import { ExtractionPass } from './ExtractionPass';
import { WeNode } from './WeNode';

@Model({ name: 'CollectionBlock' })
export class CollectionBlock extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://collection_block' })
  flag: string = '';

  @Property({ through: 'we://editor_state', resolveLanguage: FILE_STORAGE_LANGUAGE })
  editorState: string | null = null;

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
  @Property({ through: 'we://type' })
  type: string = '';

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
  @Property({ through: 'we://slug' })
  slug: string = '';

  @Property({ through: 'we://description' })
  description: string = '';

  @Property({ through: 'we://version' })
  version: number = 0;

  @Property({ through: 'we://text_content' })
  textContent: string = '';

  /**
   * Where this was posted before it was posted here — a reference to the original, and its space
   * by name.
   *
   * Written only when an author brings their own post from one shared space into another, and
   * only as a **portable** reference (`we:n:<cid>/…`): a reference into a personal dataset names
   * nothing to anybody else, and would say that a private note exists. So a note shared into a
   * space carries neither, and reads as what it is — a post, written here.
   *
   * Somebody else's post is never copied, so it never gets these: bringing one in makes a post
   * that *quotes* it, through an `EmbedBlock` carrying its author. See `bringIn` in the shell.
   *
   * `sourceName` is a snapshot, for the reason the Pocket keeps one: a card must be able to say
   * "also posted in Gardeners" without resolving a dataset its reader may not have joined.
   */
  @Property({ through: 'we://source_ref' })
  sourceRef: string = '';

  @Property({ through: 'we://source_name' })
  sourceName: string = '';

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
  @HasMany({ through: 'we://children', ordering: { strategy: 'linkedList' }, polymorphic: true })
  children: string[] = [];

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
  @HasMany({ through: 'we://arranges', ordering: { strategy: 'linkedList' }, polymorphic: true })
  arranges: string[] = [];

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
  @HasOne({ through: 'we://gathers', polymorphic: true })
  gathers?: string;

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
  @HasOne(() => CollectionBlock, { through: 'we://board' })
  board?: CollectionBlock;

  /**
   * Every time a model was asked to read this collection — see {@link ExtractionPass}.
   *
   * Its own relation rather than `children`, which holds a collection's *content*: a pass is a
   * fact about the collection, not something in it, and in `children` it would be loaded by the
   * board and drawn as a card.
   */
  @HasMany(() => ExtractionPass, { through: 'we://extraction_pass_record' })
  extractionPasses: string[] = [];

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
  @HasMany({ through: 'we://extracted', polymorphic: true })
  extracted: string[] = [];

  /**
   * Changes a pass suggested to records that already existed, and somebody kept — see
   * {@link ExtractionAmendment}.
   *
   * The counterpart to {@link extracted} for the other kind of suggestion a pass makes, and it
   * is a separate relation rather than more entries in that one because the two are about
   * different things. `extracted` names *records* the call produced; this names *amendments*,
   * which are their own records and whose subject is usually something the call did not create
   * — a task somebody had already written down, which the conversation then moved on.
   *
   * That difference is also why an amendment could not be reported by marking the extracted
   * record instead. A change accepted on a record no pass here wrote has nothing in `extracted`
   * to mark, and that is the ordinary case rather than the edge: a change proposal targets an
   * already-agreed record by definition.
   *
   * Typed, unlike `extracted`, because an amendment is always the same entity — there is no
   * open vocabulary here, only whatever the amended record happens to be, which the amendment
   * itself points at.
   */
  @HasMany(() => ExtractionAmendment, { through: 'we://extraction_amendment' })
  amendments: string[] = [];
}

export interface CollectionBlock extends HasManyMethods<'children' | 'arranges'> {
  /** Generated by @HasOne — links a new CollectionBlock as this collectionblock's board. */
  setBoard(value: Pick<CollectionBlock, 'id'>): Promise<void>;
}
