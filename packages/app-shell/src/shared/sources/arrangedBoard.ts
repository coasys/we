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
  involvement,
  type InvolvementKindInput,
  type InvolvementRowInput,
  type PendingInvolvement,
} from './involvement';

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
  /**
   * Arrangements written and not yet seen come back — see `@we/optimism`.
   *
   * Applied to the **inputs** rather than to the answers below, which is the whole reason this is
   * three lines rather than a second pass over every field. `contents`, `unplaced`, `available` and
   * the counts are all derived from the columns' `arranges` and the records' `status`; substitute
   * those two before the working out and every one of them follows, including the ones nobody would
   * remember to patch — a heading's count, and whether the Unplaced column appears at all.
   */
  pending?: PendingBoardState | null;
  /** The `Involvement` rows — who is on what. Omit for a board that does not filter by people. */
  involvements?: InvolvementRowInput[] | null;
  /** `spaceStore.involvementTypes`, so a declined answer is known as one whatever it is called. */
  kinds?: InvolvementKindInput[] | null;
  /** The DIDs of the people chosen. Empty means nobody is chosen, and nothing is filtered. */
  people?: string[] | null;
  /** How cards nobody chosen is on are drawn — `dim` (the default), `hide`, or `rows`. See above. */
  show?: string | null;
  /** The viewer's DID, so `involved` can lead with them. */
  me?: string | null;
  /** Involvements written and not yet seen — see `involvementOptimism`. Supplied by the host. */
  pendingInvolvements?: readonly PendingInvolvement[] | null;
}

/** The key of the row for work nobody is on. DIDs begin `did:`, so it cannot collide with one. */
export const NOBODY_ROW = 'nobody';

/** What one cell of a board laid out a row per person shows. */
export interface CellContents {
  arranged: CardRow[];
  unarranged: CardRow[];
  count: number;
}

/**
 * What has been written and not yet observed: an order per `<recordId>.<relation>`, and a state per
 * record.
 *
 * Both are needed and neither is enough. Dropping a card into a bound column writes two things — the
 * target column's order, and the card's own `status` — and they arrive on two different
 * subscriptions. Overlaying only the order leaves a window where the column claims the card and the
 * stale-hint rule below throws it out again for having the wrong state, which draws the card in
 * *neither* column: worse than the flash, and the reason this takes both.
 */
export interface PendingBoardState {
  /** The order to draw, by `<recordId>.<relation>`; `undefined` means draw what arrived. */
  order?: (recordId: string, relation: string, observed: readonly string[]) => string[] | undefined;
  /**
   * The state to read a record as having, or `undefined` to read the stored one.
   *
   * Given what the record actually says, for the same reason `order` is: whether an overlay still
   * applies is decided by whether the data has moved since it was written, and only the caller of
   * this function has the data.
   */
  status?: (recordId: string, observed: string | undefined) => string | undefined;
}

export interface BoardRow {
  id?: string;
  children?: unknown[];
  arranges?: unknown[];
  gathers?: unknown;
}

export interface ColumnRow {
  id: string;
  slug?: string;
  title?: string;
  arranges?: unknown[];
}

export interface CardRow {
  id: string;
  status?: string;
}

export interface StateRow {
  slug: string;
  name?: string;
  semantic?: string;
  color?: string;
  icon?: string;
  retired?: boolean;
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

/** A relation comes back as ids, or as hydrated rows carrying an id; read either. */
function idsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') out.push(entry);
    else if (entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string') {
      out.push((entry as { id: string }).id);
    }
  }
  return out;
}

const asRows = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

export function arrangedBoard(options: ArrangedBoardOptions | null | undefined): ArrangedBoard {
  const board = options?.board ?? null;
  const columnRows = asRows<ColumnRow>(options?.columns).filter((c) => c && typeof c.id === 'string');
  const records = asRows<CardRow>(options?.records).filter((r) => r && typeof r.id === 'string');
  const states = asRows<StateRow>(options?.states);
  const pending = options?.pending ?? null;

  /*
    The two substitutions the overlay makes, and the only two places it is consulted.

    Everything below reads a relation's order through `arrangesOf`/`childrenOf` and a record's state
    through `statusOf`, so an arrangement that has been written and not yet observed is indis-
    tinguishable here from one that has. That is deliberate: the alternative is a second pass that
    patches the answers, and the answers are eight fields derived from these two — the one somebody
    forgets to patch is a heading's count, and it disagrees with the cards under it.
  */
  const orderOf = (id: string | undefined, relation: string, stored: unknown): string[] => {
    const observed = idsOf(stored);
    if (!id || !pending?.order) return observed;
    return pending.order(id, relation, observed) ?? observed;
  };
  const arrangesOf = (record: { id?: string; arranges?: unknown } | null | undefined) =>
    orderOf(record?.id, 'arranges', record?.arranges);
  const childrenOf = (record: { id?: string; children?: unknown } | null | undefined) =>
    orderOf(record?.id, 'children', record?.children);
  const statusOf = (record: CardRow): string | undefined =>
    pending?.status?.(record.id, record.status) ?? record.status;

  const ready = Boolean(board && typeof board === 'object' && board.id);
  const gathers = Boolean(ready && board?.gathers);

  // The board says the order; the columns query says the contents. A child the columns query does
  // not know — deleted by another agent, or not a column at all — renders as nothing rather than a hole.
  const byId = new Map(columnRows.map((c) => [c.id, c]));
  const columns = ready
    ? childrenOf(board)
        .map((id) => byId.get(id))
        .filter((c): c is ColumnRow => Boolean(c))
    : [];

  const recordById = new Map(records.map((r) => [r.id, r]));
  const stateBySlug = new Map(states.filter((s) => s && s.slug).map((s) => [s.slug, s]));

  // Everything this board holds anywhere: its columns' arrangements, and what it holds in no column.
  const held = new Set<string>();
  for (const column of columns) for (const id of arrangesOf(column)) held.add(id);
  for (const id of arrangesOf(board)) held.add(id);

  // The work this board could show: everything in scope, or only what it holds.
  const pool = gathers ? records : records.filter((r) => held.has(r.id));

  // Placed somewhere that *shows* it: a lane it is arranged in, or a bound column whose slug still
  // matches. A hint in a column that no longer matches counts for nothing, so the card falls back to
  // its state's column rather than vanishing.
  const placed = new Set<string>();
  for (const column of columns) {
    const bound = Boolean(column.slug);
    for (const id of arrangesOf(column)) {
      const record = recordById.get(id);
      if (!record) continue;
      if (!bound || statusOf(record) === column.slug) placed.add(id);
    }
  }

  const boundSlugs = new Set(columns.map((c) => c.slug).filter((s): s is string => Boolean(s)));

  const contents: Record<string, ColumnContents> = {};
  for (const column of columns) {
    const slug = column.slug ?? '';
    const state = slug ? stateBySlug.get(slug) : undefined;
    const arranged = arrangesOf(column)
      .map((id) => recordById.get(id))
      .filter((r): r is CardRow => Boolean(r) && (!slug || statusOf(r!) === slug));
    const unarranged = slug ? pool.filter((r) => statusOf(r) === slug && !placed.has(r.id)) : [];
    const semantic = state?.semantic ?? 'open';
    contents[column.id] = {
      id: column.id,
      slug,
      lane: !slug,
      label: column.title || state?.name || slug || 'Untitled',
      icon: slug ? state?.icon || iconForSemantic(semantic) : '',
      color: slug ? state?.color || fillForSemantic(semantic) : LANE_COLOR,
      arranged,
      unarranged,
      count: arranged.length + unarranged.length,
      // Filled in below, once the board knows who is on what.
      shown: arranged.length + unarranged.length,
      matched: arranged.length + unarranged.length,
      order: [],
    };
  }

  const unplacedAll = pool.filter((r) => !placed.has(r.id) && !boundSlugs.has(statusOf(r) ?? ''));

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
    pending: options?.pendingInvolvements ?? null,
    me: options?.me ?? null,
  });
  const on = everyoneOn.byNode;
  const peopleOn = (record: CardRow) => on[record.id]?.dids ?? [];
  const matches = (record: CardRow) => !filtering || peopleOn(record).some((did) => chosen.has(did));
  const hiding = filtering && show !== 'dim';

  const onBoard = new Map<string, CardRow>();
  for (const column of columns) {
    const cell = contents[column.id];
    cell.order = [...cell.arranged, ...cell.unarranged].map((r) => r.id);
    cell.matched = filtering ? [...cell.arranged, ...cell.unarranged].filter(matches).length : cell.count;
    for (const record of [...cell.arranged, ...cell.unarranged]) onBoard.set(record.id, record);
  }
  for (const record of unplacedAll) onBoard.set(record.id, record);
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
      cell.arranged = cell.arranged.filter(matches);
      cell.unarranged = cell.unarranged.filter(matches);
    }
  }
  for (const column of columns) {
    const cell = contents[column.id];
    cell.shown = cell.arranged.length + cell.unarranged.length;
  }
  const unplaced = hiding ? unplacedAll.filter(matches) : unplacedAll;
  const seen = new Set<string>();
  const unplacedStates: { slug: string; name: string }[] = [];
  for (const record of unplacedAll) {
    const slug = statusOf(record) ?? '';
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    unplacedStates.push({ slug, name: stateBySlug.get(slug)?.name || slug });
  }

  return {
    ready,
    gathers,
    columns,
    contents,
    unplaced,
    unplacedStates,
    available: records.filter((r) => !held.has(r.id)),
    choices: columns.map((c) => ({ id: c.id, label: contents[c.id].label })),
    unboundStates: states
      .filter((s) => s && s.slug && !s.retired && !boundSlugs.has(s.slug))
      .map((s) => ({ slug: s.slug, name: s.name || s.slug })),
    total: records.length,
    // Everyone's order, narrowed to who is on a card here — so the viewer still leads.
    involved: everyoneOn.dids.filter((did) => onThisBoard.has(did)),
    filtering,
    show,
    dimmed:
      filtering && show === 'dim'
        ? [...onBoard.values()].filter((record) => !matches(record)).map((record) => record.id)
        : [],
    cardCount: onBoard.size,
    matchedCount: filtering ? [...onBoard.values()].filter(matches).length : onBoard.size,
    unplacedTotal: unplacedAll.length,
    rows,
    cells,
    rowCounts,
  };
}
