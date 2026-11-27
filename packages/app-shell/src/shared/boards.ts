/**
 * What a board write means.
 *
 * A board's columns are records: the board's ordered `children` are its columns, and each column's
 * ordered `arranges` are the cards somebody put in it. The reasoning — why a column is a saved query
 * with an arrangement rather than a container, why arrangement is its own relation rather than more
 * meaning on `children`, and why that is what survives a partition — is `docs/architecture/boards.md`.
 *
 * **The ordering is not here.** An ordered relation is an RGA in the executor: it diffs a written
 * list against what it holds, records only what moved, and converges when two people drag at the
 * same moment. Nothing in this file indexes, renumbers, merges or breaks a tie — which is the whole
 * reason a column's arrangement is a relation rather than a `position` scalar on each card.
 *
 * What *is* here is everything a backend cannot be asked: which list to store (the visible order,
 * then the hints the screen no longer shows), what a drop means (up to three writes, the third
 * conditional on whether the target column names a state), the invariants only WE knows (a board's
 * children are columns; a board says what it gathers), and when a shared record is allowed to come
 * into being.
 *
 * **The writes themselves are declared operations** (`core.createBoard`, `core.moveCard` … in
 * `@we/entities`' manifest), so every host, an agent and a template make the same ones. What stays
 * here is what only this host can do around them: draw an arrangement before it lands, ask a
 * workflow, settle a staged suggestion, read the space's landmarks, and say a failure in a toast.
 *
 * Framework-neutral, per `CONVENTIONS.md`: the things that reach outside — which dataset, who is
 * acting, what the community's states are, and how a failure reaches a person — arrive as
 * `BoardDeps` rather than as imports.
 */
import { CollectionBlock, type DatasetProxy, getEntityForDataset, runOperation, type TaskBlock } from '@we/entities';

import { spliceSubsetOrder } from './shapes/subsetOrder';
import { readSpaceLandmarks, readSpaceRoot } from './spaceLandmarks';
import type { TaskMoveOutcome } from './taskWorkflow';

/** What the board actions need from the app around them. */
export interface BoardDeps {
  /**
   * The dataset a write means: the one named, or the space on screen.
   *
   * Named rather than assumed, because a board is not always made where the reader is looking — the
   * extraction hook runs wherever the election landed, and a board must not land somewhere its own
   * cards did not.
   */
  dataset: (uri?: string) => DatasetProxy | undefined;
  /** The signed-in agent, whom the writes are made as; nothing is written while there is none. */
  invoker: () => string | undefined;
  /** The states this community offers, in its own order — what a new board's columns are seeded from. */
  offeredStates: () => { name: string; slug: string }[];
  /** How a failure reaches the person who caused it. */
  notify: (message: string) => void;
  /** The space's landmarks changed — a board was made the space's — so whatever holds them reads again. */
  landmarksChanged?: () => void;
  /**
   * Drop a staged suggestion for one property of one record, if extraction left one there.
   *
   * A proposed task carries the model's `status` on its overlay until somebody presses Keep, and Keep
   * copies every staged value onto the record. So a card dragged to Doing and *then* kept jumped back
   * to To do: the older suggestion overwrote the decision a person had just made with a drag. A human
   * write to a property is a decision about any suggestion for it, and this is how the board says so
   * before it writes. Optional, since a host without extraction has nothing to settle.
   */
  resolveSuggestion?: (recordId: string, property: string) => Promise<void>;
  /**
   * Show an arrangement before it is stored, and stop showing it when it fails.
   *
   * A drop writes a relation and then waits about a second for the subscription to come back, during
   * which the card is drawn from the last answer — back where it started. `hold` is what the board
   * draws in the meantime; `release` withdraws it, and is called only when the write **failed**.
   *
   * A write that succeeded is not released here, and that is the point. Releasing on success would
   * mean releasing when the promise resolves, which is earlier than the data arriving — so the card
   * would go back for the rest of the round trip, which is the flash again with extra steps. What
   * releases a successful one is the data moving, which only whatever draws the board can see.
   *
   * Optional, so a host that would rather wait for the truth simply passes neither.
   */
  hold?: (recordId: string, relation: string, ids: readonly string[]) => void;
  /** Withdraw a held arrangement — the write failed, so what is on screen is a lie. */
  release?: (recordId: string, relation: string) => void;
  /**
   * A write for this relation has returned successfully.
   *
   * Not a release — see above. What it does is end the hold's exemption from judgement: until the
   * last write behind it is back, nothing the data says is about it yet. Without this, a board
   * dragged twice in a second can have the first drag's echo read as "the data has moved" while the
   * second drag is what is on screen, and the card jumps back and then forward again.
   */
  done?: (recordId: string, relation: string) => void;
  /** The same pair for a card's state, which a drop into a bound column writes alongside the order. */
  holdStatus?: (recordId: string, status: string) => void;
  releaseStatus?: (recordId: string) => void;
  doneStatus?: (recordId: string) => void;
  /**
   * The space's task workflow, where its states ask for agreement — see `taskWorkflow.ts`.
   *
   * With one, a drop into a bound column *asks* for the card's new state rather than writing it: the
   * move happens, and the arrangement and `status` are written as before, only once enough people
   * have asked; otherwise the card stays where it was and its card says what it is waiting on.
   * Optional, and a space whose states ask for nothing behaves exactly as if it were absent.
   */
  workflow?: BoardWorkflow;
}

/** What the board needs from a task workflow. */
export interface BoardWorkflow {
  /** Whether the space's states run as a workflow at all. */
  enabled: () => boolean;
  /** Whether a drop into this state waits for agreement, so nothing should be drawn ahead of it. */
  needsAgreement: (slug: string) => boolean;
  /** The state a task's run is in, where it has one. */
  stateOf: (taskId: string) => string | undefined;
  /** Ask for a move. `null` means the space has no workflow after all, and the caller writes the state. */
  move: (taskId: string, from: string, to: string) => Promise<TaskMoveOutcome>;
  /** The state a task made into a column that asks for agreement starts in instead. */
  entryFor: (to: string) => string;
  /** Why a move was refused, in a sentence naming the rule — `null` to say it plainly. */
  explain?: (from: string, to: string, outcome: TaskMoveOutcome) => string | null;
}

export interface CreateBoardOptions {
  /** The dataset to write into; the space on screen when omitted. */
  dataset?: string;
  /**
   * What the board draws its work from — a container's record id, or the Space record's for the
   * space's own board. Omit for a board that shows only what somebody puts on it.
   */
  gathers?: string;
}

/** The board actions, as the store exposes them. */
export interface BoardActions {
  createBoard: (title: string, parentId?: string, options?: CreateBoardOptions) => Promise<string>;
  openBoardFor: (anchorId?: string, title?: string, dataset?: string) => Promise<string>;
  ensureBoardFor: (collectionId: string, dataset?: string) => Promise<string>;
  addBoardColumn: (boardId: string, name: string, slug?: string) => Promise<void>;
  addStateToSpaceBoard: (slug: string, name: string) => Promise<void>;
  removeBoardColumn: (boardId: string, columnId: string) => Promise<void>;
  renameBoardColumn: (columnId: string, name: string) => Promise<void>;
  reorderBoardColumns: (boardId: string, orderedIds: string[]) => Promise<void>;
  arrangeColumn: (columnId: string, orderedIds: string[], columnOrder?: string[]) => Promise<void>;
  moveCardToColumn: (
    fromColumnId: string,
    toColumnId: string,
    cardId: string,
    orderedIds?: string[],
    toSlug?: string,
    columnOrder?: string[],
  ) => Promise<void>;
  addTaskToColumn: (columnId: string, title: string, anchorId?: string) => Promise<void>;
}

const ids = (value: unknown): string[] => (Array.isArray(value) ? (value as string[]) : []);

// The registry answers untyped, but what it holds under 'TaskBlock' is the TaskBlock class.
const taskEntity = (dataset: DatasetProxy) => getEntityForDataset('TaskBlock', dataset) as typeof TaskBlock | undefined;

export function createBoardActions(deps: BoardDeps): BoardActions {
  const { dataset, offeredStates, notify, resolveSuggestion, workflow } = deps;
  const hold = deps.hold ?? (() => {});
  const release = deps.release ?? (() => {});
  const holdStatus = deps.holdStatus ?? (() => {});
  const releaseStatus = deps.releaseStatus ?? (() => {});
  const done = deps.done ?? (() => {});
  const doneStatus = deps.doneStatus ?? (() => {});

  /** Run one of the board operations as the signed-in agent, in the dataset given. */
  async function run<T>(name: string, args: Record<string, unknown>, p: DatasetProxy): Promise<T> {
    const invoker = deps.invoker();
    if (!invoker) throw new Error(`${name}: nobody is signed in`);
    return (await runOperation(name, args, { dataset: p, invoker })) as T;
  }

  /** The states a new board gets a column for: the community's order, each slug once. */
  const offeredSlugs = () => [
    ...new Set(
      offeredStates()
        .map((state) => state.slug)
        .filter(Boolean),
    ),
  ];
  /** The states as an operation reads a column's title against them. */
  const statesArg = () => offeredStates().map(({ slug, name }) => ({ slug, name }));

  /**
   * Make a board, with a column for each state the community uses.
   *
   * A `CollectionBlock` like a call or a notes collection, so it inherits comments, signals, the
   * feed and the rest — and `mode: 'feed'` rather than `'document'`, which is the one field that
   * must be right. `reconcileBlocks` refuses anything not `'document'` precisely because running it
   * over a feed deletes every child the editing agent's tree omits, and on a shared board that is
   * everyone else's cards.
   *
   * ## The columns are records, and they are written now rather than lazily
   *
   * Written at creation rather than materialised on the first drag, which was the alternative: lazy
   * creation means two members dragging at the same moment both find no structure and both make
   * one, and it means the first drag anybody makes rebuilds the column list under them —
   * `taskStates` is a memo returning fresh objects and `<For>` is reference-keyed, so every column
   * would remount and re-issue its subscription. Creating a board is already a deliberate act by one
   * person; doing the work there costs one round trip and avoids both.
   *
   * A state named *later* reaches a board two ways: the space's own board gains a column for it the
   * moment it is named (see `addStateToSpaceBoard`), and any other board offers one from its
   * Unplaced column the first time work in that state shows up there.
   *
   * `parentId` puts the board inside another collection — a call's record, so the board belongs to
   * the gathering it came out of. `gathers` says what it draws from; which board is the *canonical*
   * one for a container is the container's `board` relation, set by `openBoardFor`. A call may hold
   * any number of boards, all of them its children; one of them is the one it points at.
   *
   * One transaction, so nobody sees a board with no columns between the writes.
   *
   * ## The columns are made first, and handed to the board as it is created
   *
   * Not written onto it afterwards. A record created in a batch cannot be read back until the batch
   * commits — the executor stages it out of every query — and a relation write by id starts with
   * exactly that read. So `setRelation(board.id, 'children', …)` inside this transaction found no
   * board, did nothing, and said nothing: every board came out pointed at by its call and holding no
   * columns, while three column records sat in the space with nothing pointing at them. The columns
   * themselves are only *named* by the board's create, never read, so making them first is safe.
   */
  async function createBoard(title: string, parentId?: string, options?: CreateBoardOptions): Promise<string> {
    const p = dataset(options?.dataset);
    if (!p || !title.trim()) return '';
    try {
      return await run<string>(
        'core.createBoard',
        { title, states: offeredSlugs(), parent: parentId, gathers: options?.gathers },
        p,
      );
    } catch (error) {
      console.error('SpaceStore: could not create board', error);
      notify('Could not create that board');
      return '';
    }
  }

  /**
   * The board for a container — one call's, or the space's own — making it if nobody has yet.
   *
   * Find-or-create rather than create, because every surface that opens a board calls this and only
   * the first caller should write. Returns the id either way, so the caller opens what it asked for
   * without knowing which happened.
   *
   * Reached from a click rather than from a view mounting, deliberately. Creating a board writes
   * records into a space everybody shares, and a side effect of *navigating* is a poor way to do
   * that: on a neighbourhood it would mean everyone who opened the tab raced to make the same board.
   */
  async function openBoardFor(anchorId?: string, title?: string, datasetUri?: string): Promise<string> {
    const p = dataset(datasetUri);
    if (!p) return '';
    try {
      /*
        The container points at its board, rather than the board carrying a marker saying it is the
        one — a single-valued link converges where two members press this at once. The operation
        finds it or makes it, gathering from the container, in one transaction.
      */
      if (anchorId)
        return await run<string>('core.openBoardFor', { anchor: anchorId, title, states: offeredSlugs() }, p);

      /*
        The space's own board is its `board` landmark — a new space's starter makes one; this makes it
        for a space whose starter did not. Read here, since two landmarks of one name resolve to the
        newest by the rule `readSpaceLandmarks` reads them with. It gathers from the space collection,
        where everything top-level lives, or from the space record in a space made before spaces had
        one.
      */
      const existing = (await readSpaceLandmarks(p)).board;
      if (existing) return existing;
      const space = await readSpaceRoot(p);
      if (!space) return '';
      const made = await run<string>(
        'core.makeSpaceBoard',
        { space: space.id, root: space.root || undefined, title, states: offeredSlugs() },
        p,
      );
      if (made) deps.landmarksChanged?.();
      return made;
    } catch (error) {
      console.error('SpaceStore: could not open that board', error);
      notify('Could not open that board');
      return '';
    }
  }

  /**
   * Make sure a container has a board, but only once it has work for one.
   *
   * The hook extraction calls. A call gets no board until a pass leaves it holding a task — which is
   * the rule worth stating in those words, because the alternative ("any record at all") would give
   * an events-only call an empty kanban and nobody could say why.
   *
   * `InterpretationResult` carries ids and no types, so the pass cannot answer this on its own; one
   * query does, and it runs after an LLM round trip, where its cost is nothing.
   */
  async function ensureBoardFor(collectionId: string, datasetUri?: string): Promise<string> {
    const p = dataset(datasetUri);
    if (!p || !collectionId) return '';
    try {
      // One read of the collection's children's ids asks whether any is a task, inside the operation.
      return (await run<string>('core.ensureBoardFor', { collection: collectionId, states: offeredSlugs() }, p)) ?? '';
    } catch (error) {
      console.error('SpaceStore: could not prepare a board for that collection', error);
      return '';
    }
  }

  /**
   * Add a column to a board — one bound to a state, or a lane of this board's own.
   *
   * `slug` is the whole difference, and it is two different promises:
   *
   * - **With one**, the column *is* that state on this board. Work in that state arrives on its own,
   *   including work an interpretation pass wrote while nobody was looking, and dropping a card there
   *   says the card is in that state — everywhere, on every board.
   * - **Without one**, it is a local lane. Nothing arrives by itself, which is the price of claiming
   *   no shared meaning, and a card put there is positioned rather than reclassified.
   *
   * So the caller says which, rather than this guessing from whether the name happens to match a
   * state. A lane that turns out to matter is promoted by naming it in the space's vocabulary.
   */
  async function addBoardColumn(boardId: string, name: string, slug = ''): Promise<void> {
    const p = dataset();
    if (!p || !boardId || (!name.trim() && !slug)) return;
    try {
      await run('core.addBoardColumn', { board: boardId, name, slug: slug || undefined, states: statesArg() }, p);
    } catch (error) {
      console.error('SpaceStore: could not add that column', error);
      notify('Could not add that column');
    }
  }

  /**
   * Give the space's own board a column for a state, if it has a board and lacks one.
   *
   * Called when a state is named, so Everything — the catch-all — keeps up with the vocabulary
   * rather than freezing it as of the day the board was made. One write, by the one person who
   * acted, on the one board whose job is to show all of the work: the fan-out to every board that
   * this design refuses is precisely what this is not. A board somebody made is left alone; its
   * Unplaced column offers the new state the first time work in it turns up there.
   */
  async function addStateToSpaceBoard(slug: string, name: string): Promise<void> {
    const p = dataset();
    if (!p || !slug) return;
    try {
      const boardId = (await readSpaceLandmarks(p)).board;
      if (!boardId) return;
      await run('core.addStateColumn', { board: boardId, slug, name, states: statesArg() }, p);
    } catch (error) {
      // Not worth a toast: the state was named, which is what the person asked for. The board
      // offers the column itself the first time the state's work appears in Unplaced.
      console.warn('SpaceStore: could not add the new state to the space board', error);
    }
  }

  /**
   * Take a column off a board — **the column only, never the work in it.**
   *
   * A column's `arranges` are cards it *positions*, not cards it owns, and nothing that walks
   * `children` follows it — so deleting the column record cannot reach a card. That is the property
   * `arranges` exists to give.
   *
   * ## The cards are handed to the board first
   *
   * On a board that gathers, deleting a column loses nothing on its own: the board draws from
   * everything in scope, so a card reappears in a column bound to its state, or in Unplaced. On a
   * board somebody **made**, membership *is* arrangement — so the column being deleted held the only
   * record that these cards were on this board at all, and deleting it would take them off the board
   * silently. That contradicts the rule the whole design exists for, and it is what somebody would
   * see: delete a lane, and the card that was in it is simply gone.
   *
   * So the cards move up to the board's own `arranges`, which is where a made board keeps what it
   * holds in no column. Nothing decides *which* column they belong in, because nothing has to — a
   * column bound to their state gathers them back as unarranged, and Unplaced catches the ones whose
   * state no column here names. The same write on a gathering board is harmless: it already showed
   * them. One transaction, so no reader catches the board between losing the column and gaining
   * its cards.
   */
  async function removeBoardColumn(boardId: string, columnId: string): Promise<void> {
    const p = dataset();
    if (!p || !boardId || !columnId) return;
    try {
      await run('core.removeBoardColumn', { board: boardId, column: columnId }, p);
    } catch (error) {
      console.error('SpaceStore: could not remove that column', error);
      notify('Could not remove that column');
    }
  }

  /**
   * Rename one column, on this board.
   *
   * The label only — the slug it binds to, which is its meaning, is untouched. So two boards may
   * call one state different things, which is a presentation difference and not a disagreement:
   * both still write the same `status`, and `semantic` still answers "is this outstanding" for
   * either. Renaming what a state *is* called everywhere is Settings → Vocabulary — and a bound
   * column renamed back to its state's own name stores nothing, so it follows the vocabulary again.
   */
  async function renameBoardColumn(columnId: string, name: string): Promise<void> {
    const p = dataset();
    if (!p || !columnId || !name.trim()) return;
    try {
      await run('core.renameBoardColumn', { column: columnId, name, states: statesArg() }, p);
    } catch (error) {
      console.error('SpaceStore: could not rename that column', error);
      notify('Could not rename that column');
    }
  }

  /**
   * The order this board reads its columns in. Ordered `children`, so two draggers converge.
   *
   * **Only ids the board already holds are written.** A board's children are its columns, and
   * anything else in that list renders as a column — so a caller handing over the wrong list does
   * not misfile something, it invents structure. That happened: `we-sortable` dispatched its events
   * with `bubbles: true`, so reordering *cards* inside a column reached the columns' own sortable,
   * which wrote three task ids here and drew them as three empty columns. The primitive no longer
   * bubbles, and this refuses to write what it is not given.
   */
  async function reorderBoardColumns(boardId: string, orderedIds: string[]): Promise<void> {
    const p = dataset();
    if (!p || !boardId || !Array.isArray(orderedIds) || !orderedIds.length) return;
    // On the tick of the drop, for the reason `arrangeColumn` gives.
    hold(boardId, 'children', orderedIds);
    try {
      let result: { found: boolean; written: boolean };
      try {
        result = await run('core.reorderBoardColumns', { board: boardId, ids: orderedIds }, p);
      } catch (error) {
        release(boardId, 'children');
        throw error;
      }
      if (!result.found) release(boardId, 'children');
      else if (result.written) done(boardId, 'children');
    } catch (error) {
      console.error('SpaceStore: could not reorder the columns', error);
      notify('Could not save that order');
    }
  }

  /**
   * Record the order somebody dragged one column into.
   *
   * The list is that column's cards as they now read — the ones already positioned and the ones that
   * had simply matched the state — so writing it is what turns a card nobody had placed into one
   * somebody has. Anything the list does not mention keeps its place, which matters only for a card
   * that has since moved elsewhere.
   *
   * An ordered relation rather than a `position` scalar, and this is the thing that could not be
   * done before: two people rearranging the same column at the same moment converge, where two
   * writes of the same number lose one of the answers.
   *
   * **`columnOrder` is for a column showing part of itself** — a people filter hiding cards, or one
   * person's row. The sortable hands over only what it shows, and "that, then everything else" sends
   * every hidden card to the bottom of the column for everybody. Given the column's whole order as
   * the board draws it unfiltered, the moved cards go back into their own slots instead; see
   * `spliceSubsetOrder`. Omitted, the list is taken to be the whole column, as it always was.
   */
  async function arrangeColumn(columnId: string, shownIds: string[], columnOrder?: string[]): Promise<void> {
    const p = dataset();
    if (!p || !columnId || !Array.isArray(shownIds) || !shownIds.length) return;
    const orderedIds = Array.isArray(columnOrder) ? spliceSubsetOrder(columnOrder, shownIds) : shownIds;
    /*
      Held before anything is read, which is the difference between "almost instant" and instant.

      `we-sortable` restores the dragged card's opacity and *then* dispatches, in the same tick — so
      whatever it dispatches to has one synchronous chance to reorder the list before the browser
      paints. Holding after a read forfeits it: the card is painted undimmed at its old position and
      stays there for a whole round trip.

      What is stored is the whole visible order, then whatever the column still names that it no
      longer shows — a stale hint for a card whose state changed elsewhere. The backend diffs before
      writing, so the full order costs entries only for the cards that moved.
    */
    hold(columnId, 'arranges', orderedIds);
    try {
      let result: { found: boolean };
      try {
        result = await run('core.arrangeColumn', { column: columnId, ids: orderedIds }, p);
      } catch (error) {
        release(columnId, 'arranges');
        throw error;
      }
      if (!result.found) release(columnId, 'arranges');
      else done(columnId, 'arranges');
    } catch (error) {
      console.error('SpaceStore: could not save the column arrangement', error);
      notify('Could not save that arrangement');
    }
  }

  /**
   * Move a card from one column to another.
   *
   * Up to three writes, because up to three things change. The card leaves one column's `arranges`
   * and joins another's — position, which is this board's business alone. And **if the column it
   * joins is bound to a state, the card's `status` is written too**, which every other surface
   * reads: that is what makes "done is done" true rather than true-on-this-board.
   *
   * A lane writes no status, deliberately. Dropping a card under "Thursday" positions it here and
   * says nothing about whether the work is finished, so nobody else's board moves.
   *
   * `orderedIds` is where it lands, and without it a drop would only ever append. `we-sortable`
   * reports the target zone's whole new order alongside the move, so the card can be seated exactly
   * where it was dropped — the same list `arrangeColumn` writes, which is why passing it also
   * materialises whichever of that column's cards had merely matched the state until now. The menu
   * path has no position to report and appends, which is what "move it there" means without a
   * pointer.
   *
   * One transaction. Before this the three were separate round trips, ordered add-then-remove so a
   * failure between them left the card in two columns rather than none. A batch makes the question
   * moot: every reader sees the card in one column, in one state, or the move did not happen.
   *
   * `columnOrder` is the target column's whole order, for a drop into a column showing only part of
   * itself — `arrangeColumn` says why.
   */
  async function moveCardToColumn(
    fromColumnId: string,
    toColumnId: string,
    cardId: string,
    shownIds?: string[],
    toSlug?: string,
    columnOrder?: string[],
  ): Promise<void> {
    const p = dataset();
    if (!p || !cardId || !toColumnId || fromColumnId === toColumnId) return;
    const orderedIds =
      Array.isArray(shownIds) && Array.isArray(columnOrder) && shownIds.includes(cardId)
        ? spliceSubsetOrder(
            columnOrder.filter((id) => id !== cardId),
            shownIds,
          )
        : shownIds;
    /*
      Both halves, on the tick of the drop.

      A drop into a bound column writes an order and a state, and they come back on two different
      subscriptions — so holding only the order leaves a window where the target claims the card while
      the card still reads as the old state, and the stale-hint rule throws it out of the target for
      exactly that. Drawn in neither column, which is worse than the flash.

      Which is why `toSlug` is a parameter. The state to hold is the target column's, and reading it
      here costs the round trip this timing exists to avoid — while the board that dispatched the drop
      has the slug on screen already. It is a **hint for the drawing only**: the write below still
      reads the column and uses what it finds, so a stale hint costs a frame, never a wrong write.
    */
    /*
      Except where the state waits for agreement. A card drawn in Done a frame after the drop and
      back in Doing a round trip later reads as a move that happened and was undone, which is the
      opposite of what is going on: nothing has moved, somebody has asked. The card stays put and its
      chip says so.
    */
    const asking = Boolean(toSlug && workflow?.enabled() && workflow.needsAgreement(toSlug));
    if (!asking && Array.isArray(orderedIds) && orderedIds.includes(cardId)) hold(toColumnId, 'arranges', orderedIds);
    if (!asking && toSlug) holdStatus(cardId, toSlug);
    try {
      const [from, to] = await Promise.all([
        /*
          A `from` that resolves to nothing must not cost the move.

          An id is an IRI on this backend, so a caller handing over something that is not one — a
          zone's *name*, say — does not come back empty, it refuses the query outright and takes the
          whole move with it. The target write is the part that matters; leaving a stale link behind
          is a hint the board already ignores.
        */
        fromColumnId
          ? CollectionBlock.findOne(p, { where: { id: fromColumnId } }).catch(() => null)
          : Promise.resolve(null),
        CollectionBlock.findOne(p, { where: { id: toColumnId } }),
      ]);
      if (!to) {
        release(toColumnId, 'arranges');
        return;
      }
      const task = to.slug ? await taskEntity(p)?.findOne(p, { where: { id: cardId } }) : null;
      // The drag decides the state; a staged suggestion for it, if there is one, is superseded rather
      // than left to overwrite this the moment somebody presses Keep. Before the write, so the two
      // cannot race.
      if (task && resolveSuggestion) await resolveSuggestion(cardId, 'status');
      /*
        Where the space's states run as a workflow, the drop asks rather than writes. Only a move that
        happened goes on to the writes below — the arrangement, and `status` as the mirror every other
        surface reads. One that is waiting leaves the board as it was; its card shows the question.
      */
      if (task && to.slug && workflow?.enabled()) {
        const status = (task as { status?: unknown }).status;
        const current = workflow.stateOf(cardId) ?? (typeof status === 'string' ? status : '');
        const outcome = await workflow.move(cardId, current, to.slug);
        /*
          Already there counts as moved: the writes below put `status` and the arrangement where the
          run already is, which is what every other surface should say. Only the column this board
          draws from the run may lag, until the backend next re-derives it — so the person is told.
        */
        if (outcome === 'already-there') notify('That card was already there — its column will catch up');
        else if (outcome !== null && outcome !== 'moved') {
          release(to.id, 'arranges');
          if (from) release(from.id, 'arranges');
          releaseStatus(cardId);
          if (outcome === 'stalled') notify('That card is stuck between two moves — one of them has to be withdrawn');
          if (outcome === 'slow') notify('The node is still counting that vote — the card will move when it has');
          if (outcome === 'unmet' || outcome === 'not-allowed') {
            const why = workflow.explain?.(current, to.slug, outcome);
            notify(
              why ??
                (outcome === 'unmet'
                  ? 'Not yet — what that column asks for is not there'
                  : 'That card cannot move there from where it is'),
            );
          }
          return;
        }
      }
      /*
        Shown before it is written — see `BoardDeps.hold`.

        Both halves, because a drop into a bound column writes two things that arrive on two
        different subscriptions: the target's order and the card's own state. Holding only the order
        leaves a window where the target claims the card while the card still reads as the old state,
        and the stale-hint rule below throws it out for exactly that — so it would be drawn in
        neither column, which is worse than the flash this replaces.

        After the reads rather than at the top, because the state to hold is the target column's
        slug and nothing knows it until the column has been read. That leaves one round trip of the
        old behaviour; closing it means the caller passing the slug in, which is a wider change than
        this is.
      */
      // The card appended, for a move with no position — the menu's path, which has no drop point.
      if (!Array.isArray(orderedIds) || !orderedIds.includes(cardId)) {
        hold(to.id, 'arranges', [...ids(to.arranges), cardId]);
      }
      // Only where the caller gave no hint, or gave the wrong one. Re-holding with the same value
      // would reset the entry's age and its baseline, undoing the draw that has already happened.
      if (to.slug && to.slug !== toSlug) holdStatus(cardId, to.slug);
      // The hint said a state and the column turns out to name none — a lane, whose whole point is
      // that dropping a card there changes nothing about the work. Stop claiming otherwise.
      if (!to.slug && toSlug) releaseStatus(cardId);
      // A lane writes no state, so nothing would take the card out of the column it left. Hold that
      // side too, so the card is not drawn in both at once.
      if (!to.slug && from) {
        hold(
          from.id,
          'arranges',
          ids(from.arranges).filter((id) => id !== cardId),
        );
      }

      // The writes, as one transaction: leave one column, join the other, and — for a bound column —
      // take its state. Every reader sees the card in one column, in one state, or the move did not happen.
      const dropped = Array.isArray(orderedIds) && orderedIds.includes(cardId) ? orderedIds : undefined;
      await run('core.moveCard', { to: to.id, from: from?.id, card: cardId, ids: dropped }, p);
      /*
        Every hold this move put up, reported back — see `BoardDeps.done`.

        All of them, including the `from` column's, because a hold that never hears its write
        returned stays exempt from judgement until the backstop expires, and a card would be drawn
        from a promise for ten seconds after the data agreed with it.
      */
      done(to.id, 'arranges');
      if (from) done(from.id, 'arranges');
      doneStatus(cardId);
    } catch (error) {
      // The card goes back where it was: what is on screen is a lie the moment the write is refused,
      // and the toast is the only thing saying so.
      if (toColumnId) release(toColumnId, 'arranges');
      if (fromColumnId) release(fromColumnId, 'arranges');
      releaseStatus(cardId);
      console.error('SpaceStore: could not move that card', error);
      notify('Could not move that card');
    }
  }

  /**
   * Make a task straight into a column.
   *
   * Two links rather than one, and both matter. The task is parented to the **anchor** when there is
   * one — the call the board gathers from — so every other call-scoped surface finds it, which
   * parenting it to the column instead would quietly prevent. Then it is arranged into the column,
   * so it opens where the person was looking.
   *
   * A bound column also gives it that column's state, so it would appear there anyway; the link is
   * what puts it at a known position rather than at the end. A lane gives it none, so the link is
   * the only reason it is there at all.
   */
  async function addTaskToColumn(columnId: string, title: string, anchorId?: string): Promise<void> {
    const p = dataset();
    if (!p || !columnId || !title.trim()) return;
    try {
      const column = await CollectionBlock.findOne(p, { where: { id: columnId } });
      if (!column) return;
      /*
        A column whose state waits for agreement cannot be the state a task is born in — that would be
        a way round the question. The task starts in the first state that asks for nothing, and asks
        for this one straight away, so it appears where the rest of the waiting work does, saying so.
      */
      const asking = Boolean(column.slug && workflow?.enabled() && workflow.needsAgreement(column.slug));
      const initial = asking && workflow ? workflow.entryFor(column.slug) : column.slug;
      const taskId = await run<string>(
        'core.addTaskToColumn',
        { column: column.id, title, status: initial || undefined, anchor: anchorId || undefined, arrange: !asking },
        p,
      );
      if (asking && workflow && taskId && initial) await workflow.move(taskId, initial, column.slug);
    } catch (error) {
      console.error('SpaceStore: could not add that task', error);
      notify('Could not add that task');
    }
  }

  return {
    createBoard,
    openBoardFor,
    ensureBoardFor,
    addBoardColumn,
    addStateToSpaceBoard,
    removeBoardColumn,
    renameBoardColumn,
    reorderBoardColumns,
    arrangeColumn,
    moveCardToColumn,
    addTaskToColumn,
  };
}
