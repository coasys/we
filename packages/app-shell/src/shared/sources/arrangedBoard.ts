/**
 * A board, worked out: which records each column shows, in what order, and what is left over.
 *
 * ## Why a host function and not expressions
 *
 * The first version of the board computed all of this in the expression language — a nested
 * comprehension per column, an `exists` inside a `filter` inside a `map`, the same string inlined in
 * a heading's count, an `$each`'s items and the Unplaced column's condition. It validated, and twice
 * it computed the wrong thing where nothing could see: `+` coerced two lists to `0`, and a nested
 * include that the backend refused left every card in Unplaced. The tests that caught those were
 * tests of a small query engine written in a language with no types.
 *
 * The routing table sends computation the library lacks to a function the host registers. That is
 * what this is. The fragment is arrangement again — an `$each` over `.columns`, a card per row — and
 * the meaning sits here, where it is typed, tested directly, and evaluated once per input change
 * rather than once per expression.
 *
 * ## What it decides
 *
 * The arrangement itself — what each column shows and what is left over — is the pure kernel in
 * `kernels/boardArrangement.ts`, which a second host implements against its recorded vectors. This
 * file substitutes what the host knows that the data does not (a write not yet seen, a run's state)
 * before calling it, and adds the people, the workflow and the vocabulary's icons and colours after.
 *
 * **State is a fact about the work; position is a fact about the pair.** A column shows the records
 * whose `status` matches its `slug` — a query — in the order its `arranges` puts them, then whatever
 * matches that nobody has arranged. A column with no slug is a **lane**: it shows only what it
 * arranges, and gathers nothing. A record arranged in a lane is excluded from the state columns on
 * this board, or it would appear twice.
 *
 * A stale hint — a record still listed by a column whose slug no longer matches its status — is
 * ignored, and the record falls back to being unarranged in whichever column its state now names.
 * Reading "placed" as *placed somewhere that shows it* is what keeps a stale hint from hiding work.
 *
 * Whether the board **gathers** is read off the board itself: `gathers` names the Space or the
 * container it draws from, and empty means the board shows only what it holds. A made board's
 * membership is the union of its columns' `arranges` and its own — no separate relation to keep in
 * step — and which column shows a member is still its state.
 *
 * **Unplaced** is the work in scope that no column here can show: a state no column names, and not
 * sitting in a lane. Filtering it out would be tidier and would hide work, which is the one failure
 * the design exists to prevent. `unplacedStates` are the states that work is in, so the board can
 * offer a column for each.
 *
 * ## Identity
 *
 * `columns` are the caller's own column records, reordered — never copies. The renderer's `$each`
 * keys rows by reference, so a fresh object per column per push would remount every column, and the
 * sortable inside it, on every change anywhere on the board. The same holds for the records in
 * `arranged`, `unarranged` and `unplaced`: the caller's objects, filtered. Per-column results live in
 * `contents`, keyed by id, so a column reads its own without the list changing identity.
 *
 * ## The two subscriptions it reads
 *
 * `board` supplies the column *order* — its hydrated `children` — and `columns` supplies their
 * *contents*. Two subscriptions rather than one, and the split is what makes the board update at
 * all: a card moving between columns changes a column's links and not the board's, so a subscription
 * on the board alone is not obliged to re-run, and a card hydrated through the board's `include`
 * could stay as it was until something else invalidated the query. Each subscription covers exactly
 * what changes under it. That is the client library's invalidation behaviour, not WE's, and it is
 * recorded here so the fragment need not carry it.
 *
 * ## People
 *
 * Given the involvement rows and a set of people, the board says which cards any of them is on — as
 * responsible, reviewing, anything but declined — and draws the rest one of three ways:
 *
 * - **`dim`**, the default. Every card stays where it is, and the others are listed in `dimmed`. The
 *   board keeps its shape, so a column's count still says how loaded it is.
 * - **`hide`**. The others leave `arranged`, `unarranged` and `unplaced`. `count` stays the column's
 *   true count and `shown` says how many are drawn, so a heading can say "3 of 11".
 * - **`rows`**. A row per person — the ones chosen, or with nobody chosen everyone on a card here —
 *   and one for work nobody is on, each crossing every column: `rows` are the keys, and
 *   `cells[row][column]` is what a cell shows. A card several people are on is in each of their rows,
 *   which is true, and is why a row's count is not a share of the column's.
 *
 * Both of the last two show a column only in part, so a drag inside one hands over part of an order.
 * `contents[column].order` is the column's whole order as it would be drawn unfiltered, which is
 * what `arrangeColumn` needs to put the moved cards back into their own slots rather than sending
 * every hidden card to the bottom of the column for everybody.
 *
 * Row keys are strings — a DID, or `nobody` — rather than objects, for the identity reason above: a
 * fresh object per row per push would remount every row and the sortables inside it.
 */
import { fillForSemantic, iconForSemantic } from '@we/template-kit';

import {
  arrangeBoard,
  type BoardRow,
  type CardRow,
  type ColumnRow,
  type StateRow as KernelStateRow,
} from '../kernels/boardArrangement';
import { type TaskMoveCard, taskMoveCard, type TaskWorkflowView, workflowStateOf } from '../taskWorkflow';
import { involvement, type InvolvementKindInput, type InvolvementRowInput } from './involvement';

/** What the fragment hands over: the rows of three subscriptions and the community's vocabulary. */
export interface ArrangedBoardOptions {
  /** The board record, with `children` hydrated (the columns) and `arranges` and `gathers` as ids. */
  board?: BoardRow | null;
  /** The column records — `kind: 'column'` children of the board — with `arranges` as ids. */
  columns?: ColumnRow[] | null;
  /** Every record in scope: the whole space for a gathering board, or what the pool query returns. */
  records?: CardRow[] | null;
  /** The community's states, for a heading's name, icon and colour where the column has none. */
  states?: StateRow[] | null;
  /** The `Involvement` rows — who is on what. Omit for a board that does not filter by people. */
  involvements?: InvolvementRowInput[] | null;
  /** `spaceStore.involvementTypes`, so a declined answer is known as one whatever it is called. */
  kinds?: InvolvementKindInput[] | null;
  /** The DIDs of the people chosen. Empty means nobody is chosen, and nothing is filtered. */
  people?: string[] | null;
  /** How cards nobody chosen is on are drawn — `dim` (the default), `hide`, or `rows`. See above. */
  show?: string | null;
  /**
   * A second narrowing, beside the people: only these records — what one call produced, say. Null
   * or absent narrows nothing. ANDed with the people filter, each drawn in its own mode.
   */
  only?: string[] | null;
  /** How the cards outside `only` are drawn — `dim` or `hide`. Anything else narrows nothing. */
  onlyShow?: string | null;
  /** The viewer's DID, so `involved` can lead with them. */
  me?: string | null;
  /**
   * The space's task workflow, where its states ask for agreement — supplied by the host.
   *
   * A card with a run is read as being in its run's state rather than its `status`, substituted at
   * the one place a state is read, so every count follows. See
   * `shared/taskWorkflow.ts` for why the two can differ at all.
   */
  workflow?: TaskWorkflowView | null;
  /** Draw only the cards waiting on the viewer's approval. */
  awaitingMe?: boolean | null;
}

/** The key of the row for work nobody is on. DIDs begin `did:`, so it cannot collide with one. */
export const NOBODY_ROW = 'nobody';

/** What one cell of a board laid out a row per person shows. */
export interface CellContents {
  arranged: CardRow[];
  unarranged: CardRow[];
  count: number;
}

export type { BoardRow, CardRow, ColumnRow } from '../kernels/boardArrangement';

/** A state as the host reads it: the kernel's, and how the community draws it. */
export interface StateRow extends KernelStateRow {
  color?: string;
  icon?: string;
}

/** What one column shows, and how its heading reads. */
export interface ColumnContents {
  id: string;
  slug: string;
  /** True for a column bound to no state — it positions and never gathers. */
  lane: boolean;
  /** The column's own title, else its state's current name, else its slug. */
  label: string;
  /** The community's icon for the state, else the shape its semantic implies. Empty for a lane. */
  icon: string;
  /**
   * The community's colour for the state, else the fill its semantic implies — the same answer the
   * workshop's key and Settings → Vocabulary give, from `@we/template-kit`'s one table. A lane, which
   * stands for no state, takes `LANE_COLOR` instead.
   */
  color: string;
  /** The records somebody arranged here, in that order, minus any stale hint. */
  arranged: CardRow[];
  /** The records this column's state gathers that nobody has positioned. Empty for a lane. */
  unarranged: CardRow[];
  /** Every card in the column, whatever is filtered — the true count. */
  count: number;
  /** How many `arranged` and `unarranged` draw — `count` unless people are being hidden. */
  shown: number;
  /** How many cards here the chosen people are on — `count` when nobody is chosen. */
  matched: number;
  /**
   * The column's whole order as it draws unfiltered — `arranged` then `unarranged`, as ids. What a
   * drag inside a column showing only part of itself passes to `arrangeColumn`.
   */
  order: string[];
}

export interface ArrangedBoard {
  /** A board record has arrived. Until it has, an empty board is indistinguishable from a loading one. */
  ready: boolean;
  /** The board draws work in from what `gathers` names; false for a board that shows what it holds. */
  gathers: boolean;
  /** The caller's column records, in the board's order. Iterate these. */
  columns: ColumnRow[];
  /** Each column's contents, by column id. */
  contents: Record<string, ColumnContents>;
  /** Work in scope that no column here shows. */
  unplaced: CardRow[];
  /** The states the unplaced work is in, each once — what a "add a column for this" offers. */
  unplacedStates: { slug: string; name: string }[];
  /** Records in scope that this board holds nowhere — what a "bring in existing work" picker offers. */
  available: CardRow[];
  /**
   * The columns as a picker offers them — id and label. Precomputed because an expression mapping
   * `columns` would have to call this function again per row to reach a label.
   */
  choices: { id: string; label: string }[];
  /** The states still offered that no column here is bound to — what "add a column" offers. */
  unboundStates: { slug: string; name: string }[];
  /** How many records the pool held, so a surface can say when a board is large. */
  total: number;
  /**
   * Everyone on a card on this board, declined excluded, the viewer first — the faces a people filter
   * offers inline, since choosing somebody on no card here would filter the board to nothing.
   */
  involved: string[];
  /** Whether anybody is chosen, so anything is being filtered at all. */
  filtering: boolean;
  /** How the others are drawn — `dim`, `hide` or `rows`, normalised. */
  show: 'dim' | 'hide' | 'rows';
  /** The cards to draw faded: in `dim` with somebody chosen, every card on the board none of them is on. */
  dimmed: string[];
  /** Cards on the board — every column's, and Unplaced — counted once each. */
  cardCount: number;
  /** Of those, how many the chosen people are on. `cardCount` when nobody is chosen. */
  matchedCount: number;
  /** How many cards Unplaced holds before anything is hidden. */
  unplacedTotal: number;
  /** In `rows`: one key per row, a DID or `NOBODY_ROW`, in order. Empty otherwise. */
  rows: string[];
  /** In `rows`: what each cell shows, by row key then column id. */
  cells: Record<string, Record<string, CellContents>>;
  /** In `rows`: how many cards each row holds across the board. */
  rowCounts: Record<string, number>;
  /**
   * The move each card is waiting on, by card id — only cards waiting on one. Empty where the space
   * asks for no agreement.
   */
  workflow: Record<string, TaskMoveCard>;
  /** Cards on the board whose waiting move the viewer's approval would help. */
  awaiting: string[];
  /** Whether only those are being drawn. */
  awaitingOnly: boolean;
}

/**
 * What a column with no colour of its own is drawn in: nothing here.
 *
 * There were two tables at this point in the file — a glyph per semantic, which agreed with
 * `@we/template-kit`'s, and a colour per semantic, which did not. The kit's are absolute fills; these
 * were colour *roles*. So a state the community had never coloured came out violet in the workshop's
 * key, violet on the canvas, and `text-muted` grey on the heading of its own column, and the three
 * only agreed after somebody edited the state, at which point all of them fell through to the same
 * stored string.
 *
 * A lane is the one heading with no state under it, and so the one that still names a colour here.
 * It is not the absence of a *choice* — it is the absence of a shared meaning to have a colour for —
 * and now that `open` is a hue rather than grey, the two read apart.
 */
const LANE_COLOR = 'text-muted';

const asRows = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

export function arrangedBoard(options: ArrangedBoardOptions | null | undefined): ArrangedBoard {
  const board = options?.board ?? null;
  const columnRows = asRows<ColumnRow>(options?.columns).filter((c) => c && typeof c.id === 'string');
  const records = asRows<CardRow>(options?.records).filter((r) => r && typeof r.id === 'string');
  const states = asRows<StateRow>(options?.states);
  const workflow = options?.workflow ?? null;

  /*
    A run's state, substituted once, as data, before the arrangement is worked out. Everything the
    kernel derives (every count, whether Unplaced appears) then follows it, where a second pass
    patching the answers would miss one. A card dropped and not yet stored needs no substitution: the
    rows already carry the drop, since the host lays an invoked operation's predicted writes over the
    queries they come from.
  */
  const statuses: Record<string, string> = {};
  for (const record of records) {
    const drawn = workflowStateOf(workflow, record.id) ?? record.status;
    if (drawn !== record.status && drawn !== undefined) statuses[record.id] = drawn;
  }

  const arranged = arrangeBoard({ board, columns: columnRows, records, states, statuses });
  const { ready, gathers, columns } = arranged;
  const stateBySlug = new Map(states.filter((s) => s && s.slug).map((s) => [s.slug, s]));

  const contents: Record<string, ColumnContents> = {};
  for (const column of columns) {
    const cell = arranged.contents[column.id];
    const state = cell.slug ? stateBySlug.get(cell.slug) : undefined;
    contents[column.id] = {
      id: cell.id,
      slug: cell.slug,
      lane: cell.lane,
      label: cell.label,
      icon: cell.slug ? state?.icon || iconForSemantic(cell.semantic) : '',
      color: cell.slug ? state?.color || fillForSemantic(cell.semantic) : LANE_COLOR,
      arranged: cell.arranged,
      unarranged: cell.unarranged,
      count: cell.count,
      // Filled in below, once the board knows who is on what.
      shown: cell.count,
      matched: cell.count,
      order: cell.order,
    };
  }
  const unplacedAll = arranged.unplaced;

  /*
    People. Worked out after the columns rather than threaded through them, so everything above says
    what the board holds and everything below says what of it to draw — and a board nobody filters
    runs exactly the code it ran before this existed.
  */
  const show: ArrangedBoard['show'] = options?.show === 'hide' || options?.show === 'rows' ? options.show : 'dim';
  const people = [...new Set(asRows<string>(options?.people).filter((did) => typeof did === 'string' && did))];
  const filtering = people.length > 0;
  const chosen = new Set(people);
  const everyoneOn = involvement({
    rows: options?.involvements ?? null,
    types: options?.kinds ?? null,
    me: options?.me ?? null,
  });
  const on = everyoneOn.byNode;
  const peopleOn = (record: CardRow) => on[record.id]?.dids ?? [];
  const byPeople = (record: CardRow) => !filtering || peopleOn(record).some((did) => chosen.has(did));
  /*
    And `only`, the second narrowing. Each keeps its own mode: a card the people filter dims and
    `only` hides is hidden, one only dimmed by either is dimmed. `matches` is both, which is what a
    heading's "3/12" counts.
  */
  const onlyMode = options?.onlyShow === 'hide' ? 'hide' : options?.onlyShow === 'dim' ? 'dim' : null;
  const onlyIds = options?.only && onlyMode ? new Set(asRows<string>(options.only)) : null;
  const byOnly = (record: CardRow) => !onlyIds || onlyIds.has(record.id);
  const narrowing = filtering || onlyIds !== null;
  const matches = (record: CardRow) => byPeople(record) && byOnly(record);
  const keep = (record: CardRow) =>
    (!(filtering && show !== 'dim') || byPeople(record)) && (!(onlyIds && onlyMode === 'hide') || byOnly(record));
  const hiding = (filtering && show !== 'dim') || (onlyIds !== null && onlyMode === 'hide');

  const onBoard = new Map<string, CardRow>();
  for (const column of columns) {
    const cell = contents[column.id];
    cell.matched = narrowing ? [...cell.arranged, ...cell.unarranged].filter(matches).length : cell.count;
    for (const record of [...cell.arranged, ...cell.unarranged]) onBoard.set(record.id, record);
  }
  for (const record of unplacedAll) onBoard.set(record.id, record);

  // The move each card is waiting on. Who counts toward it is whoever holds the state's kind on
  // that card, read off the same involvement rows the people filter uses.
  const workflowCards: Record<string, TaskMoveCard> = {};
  const awaiting: string[] = [];
  if (workflow) {
    for (const record of onBoard.values()) {
      const holders = (kind: string) =>
        (on[record.id]?.pairs ?? [])
          .filter((pair) => pair.endsWith(`|${kind}`))
          .map((pair) => pair.slice(0, -kind.length - 1));
      const card = taskMoveCard(workflow, record.id, holders, options?.me ?? null);
      if (!card) continue;
      workflowCards[record.id] = card;
      if (card.canApprove) awaiting.push(record.id);
    }
  }
  const awaitingOnly = Boolean(options?.awaitingMe);
  const waiting = new Set(awaiting);
  const awaited = (record: CardRow) => !awaitingOnly || waiting.has(record.id);

  const onThisBoard = new Set<string>();
  for (const record of onBoard.values()) for (const did of peopleOn(record)) onThisBoard.add(did);

  // Rows before hiding, since a row is itself a filter and draws from the whole column.
  const rows: string[] = [];
  const cells: Record<string, Record<string, CellContents>> = {};
  const rowCounts: Record<string, number> = {};
  if (show === 'rows') {
    if (filtering) rows.push(...people);
    else {
      const seen = new Set<string>();
      for (const record of onBoard.values()) {
        for (const did of peopleOn(record)) {
          if (!seen.has(did)) {
            seen.add(did);
            rows.push(did);
          }
        }
      }
    }
    rows.push(NOBODY_ROW);
    for (const row of rows) {
      const inRow = (record: CardRow) =>
        row === NOBODY_ROW ? peopleOn(record).length === 0 : peopleOn(record).includes(row);
      const held = new Set<string>();
      cells[row] = {};
      for (const column of columns) {
        const cell = contents[column.id];
        const arranged = cell.arranged.filter(inRow);
        const unarranged = cell.unarranged.filter(inRow);
        for (const record of [...arranged, ...unarranged]) held.add(record.id);
        cells[row][column.id] = { arranged, unarranged, count: arranged.length + unarranged.length };
      }
      rowCounts[row] = held.size;
    }
  }

  if (hiding) {
    for (const column of columns) {
      const cell = contents[column.id];
      cell.arranged = cell.arranged.filter(keep);
      cell.unarranged = cell.unarranged.filter(keep);
    }
  }
  // "Waiting on me" hides like the people filter does: counts stay true, `shown` says what is drawn.
  if (awaitingOnly) {
    for (const column of columns) {
      const cell = contents[column.id];
      cell.arranged = cell.arranged.filter(awaited);
      cell.unarranged = cell.unarranged.filter(awaited);
    }
    for (const row of rows) {
      for (const column of columns) {
        const cell = cells[row][column.id];
        cell.arranged = cell.arranged.filter(awaited);
        cell.unarranged = cell.unarranged.filter(awaited);
        cell.count = cell.arranged.length + cell.unarranged.length;
      }
    }
  }
  for (const column of columns) {
    const cell = contents[column.id];
    cell.shown = cell.arranged.length + cell.unarranged.length;
  }
  const unplaced = (hiding ? unplacedAll.filter(keep) : unplacedAll).filter(awaited);

  return {
    ready,
    gathers,
    columns,
    contents,
    unplaced,
    unplacedStates: arranged.unplacedStates,
    available: arranged.available,
    choices: arranged.choices,
    unboundStates: arranged.unboundStates,
    total: arranged.total,
    // Everyone's order, narrowed to who is on a card here — so the viewer still leads.
    involved: everyoneOn.dids.filter((did) => onThisBoard.has(did)),
    filtering,
    show,
    // What is drawn but does not match — kept by every hiding filter, failed by a dimming one.
    dimmed: narrowing
      ? [...onBoard.values()].filter((record) => keep(record) && !matches(record)).map((record) => record.id)
      : [],
    cardCount: onBoard.size,
    matchedCount: narrowing ? [...onBoard.values()].filter(matches).length : onBoard.size,
    unplacedTotal: unplacedAll.length,
    rows,
    cells,
    rowCounts,
    workflow: workflowCards,
    awaiting,
    awaitingOnly,
  };
}
