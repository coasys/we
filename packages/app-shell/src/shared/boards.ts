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
 * here is what only this host can do around them: ask a workflow, settle a staged suggestion, read
 * the space's landmarks, and say a failure in a toast. Each is invoked as the host invokes every
 * operation, so what it writes is drawn before it lands; arranging a column and ordering a board's
 * columns are a template's own `ops.core.arrangeColumn` and `ops.core.reorderBoardColumns`.
 *
 * Framework-neutral, per `CONVENTIONS.md`: the things that reach outside — which dataset, who is
 * acting, what the community's states are, and how a failure reaches a person — arrive as
 * `BoardDeps` rather than as imports.
 */
import { CollectionBlock, type DatasetProxy, getEntityForDataset, type TaskBlock } from '@we/entities';

import { heldRecord } from './heldFirst';
import { invokeOperation } from './invokeOperation';
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

/** The board actions, as the store exposes them. */
export interface BoardActions {
  openBoardFor: (anchorId?: string, title?: string, dataset?: string) => Promise<string>;
  ensureBoardFor: (collectionId: string, dataset?: string) => Promise<string>;
  addStateToSpaceBoard: (slug: string, name: string) => Promise<void>;
  removeBoardColumn: (boardId: string, columnId: string) => Promise<void>;
  moveCardToColumn: (
    fromColumnId: string,
    toColumnId: string,
    cardId: string,
    orderedIds?: string[],
    columnOrder?: string[],
  ) => Promise<void>;
  addTaskToColumn: (columnId: string, title: string, anchorId?: string) => Promise<void>;
}

// The registry answers untyped, but what it holds under 'TaskBlock' is the TaskBlock class.
const taskEntity = (dataset: DatasetProxy) => getEntityForDataset('TaskBlock', dataset) as typeof TaskBlock | undefined;

export function createBoardActions(deps: BoardDeps): BoardActions {
  const { dataset, offeredStates, notify, resolveSuggestion, workflow } = deps;

  /**
   * Run one of the board operations as the signed-in agent, in the dataset given — the way the host
   * runs every operation, so what it writes is drawn before it lands.
   */
  async function run<T>(
    name: string,
    args: Record<string, unknown>,
    p: DatasetProxy,
    before?: () => Promise<unknown>,
  ): Promise<T> {
    const invoker = deps.invoker();
    if (!invoker) throw new Error(`${name}: nobody is signed in`);
    return (await invokeOperation(name, args, { dataset: p, invoker, ...(before ? { before } : {}) })) as T;
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
   * Move a card from one column to another.
   *
   * Up to three writes, because up to three things change. The card leaves one column's `arranges`
   * and joins another's — position, which is this board's business alone. And **if the column it
   * joins is bound to a state, the card's `status` is written too**, which every other surface
   * reads: that is what makes "done is done" true rather than true-on-this-board. A lane writes no
   * status, deliberately. All three are `core.moveCard`, one transaction, drawn on every surface
   * before it lands — the target's order and the card's state together, so the card is never drawn
   * in neither column.
   *
   * `orderedIds` is where it lands, and without it a drop would only ever append. `we-sortable`
   * reports the target zone's whole new order alongside the move, so the card can be seated exactly
   * where it was dropped. `columnOrder` is the target column's whole order, for a drop into a column
   * showing only part of itself (see `spliceSubsetOrder`).
   *
   * ## Why this is a store action and not a template's operation call
   *
   * Two things around the write only the host can do: a staged suggestion for the card's state is
   * settled first, so a later Keep cannot overwrite the drag; and where the space's states run as a
   * workflow the drop *asks* for the move, and only a move that happened is written.
   */
  async function moveCardToColumn(
    fromColumnId: string,
    toColumnId: string,
    cardId: string,
    shownIds?: string[],
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
    const dropped = Array.isArray(orderedIds) && orderedIds.includes(cardId) ? orderedIds : undefined;
    try {
      // As the board on screen holds them where it does, so the drop is drawn on the drop.
      const [from, to] = await Promise.all([
        /*
          A `from` that resolves to nothing must not cost the move.

          An id is an IRI on this backend, so a caller handing over something that is not one — a
          zone's *name*, say — does not come back empty, it refuses the query outright and takes the
          whole move with it. The target write is the part that matters; leaving a stale link behind
          is a hint the board already ignores.
        */
        fromColumnId
          ? heldRecord<CollectionBlock>('CollectionBlock', p, fromColumnId, () =>
              CollectionBlock.findOne(p, { where: { id: fromColumnId } }).catch(() => null),
            )
          : Promise.resolve(null),
        heldRecord<CollectionBlock>('CollectionBlock', p, toColumnId, () =>
          CollectionBlock.findOne(p, { where: { id: toColumnId } }),
        ),
      ]);
      if (!to) return;
      const task = to.slug
        ? await heldRecord<TaskBlock>('TaskBlock', p, cardId, async () =>
            taskEntity(p)?.findOne(p, { where: { id: cardId } }),
          )
        : null;
      // The drag decides the state; a staged suggestion for it, if there is one, is superseded rather
      // than left to overwrite this the moment somebody presses Keep. Before the write, so the two
      // cannot race — and after the drop is drawn, since nothing on screen waits for it.
      const settle = task && resolveSuggestion ? () => resolveSuggestion(cardId, 'status') : undefined;
      /*
        Where the space's states run as a workflow, the drop asks rather than writes. Only a move that
        happened goes on to the write below — the arrangement, and `status` as the mirror every other
        surface reads. One that is waiting leaves the board as it was; its card shows the question.
        Nothing was drawn ahead of it, so there is nothing to take back.
      */
      if (task && to.slug && workflow?.enabled()) {
        if (settle) await settle();
        const status = (task as { status?: unknown }).status;
        const current = workflow.stateOf(cardId) ?? (typeof status === 'string' ? status : '');
        const outcome = await workflow.move(cardId, current, to.slug);
        /*
          Already there counts as moved: the write below puts `status` and the arrangement where the
          run already is, which is what every other surface should say. Only the column this board
          draws from the run may lag, until the backend next re-derives it — so the person is told.
        */
        if (outcome === 'already-there') notify('That card was already there — its column will catch up');
        else if (outcome !== null && outcome !== 'moved') {
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
        await run('core.moveCard', { to: to.id, from: from?.id, card: cardId, ids: dropped }, p);
        return;
      }
      await run('core.moveCard', { to: to.id, from: from?.id, card: cardId, ids: dropped }, p, settle);
    } catch (error) {
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
    openBoardFor,
    ensureBoardFor,
    addStateToSpaceBoard,
    removeBoardColumn,
    moveCardToColumn,
    addTaskToColumn,
  };
}
