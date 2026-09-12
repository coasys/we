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
 */

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
   * Arrangements written and not yet seen come back — see `shapes/pendingOrder`.
   *
   * Applied to the **inputs** rather than to the answers below, which is the whole reason this is
   * three lines rather than a second pass over every field. `contents`, `unplaced`, `available` and
   * the counts are all derived from the columns' `arranges` and the records' `status`; substitute
   * those two before the working out and every one of them follows, including the ones nobody would
   * remember to patch — a heading's count, and whether the Unplaced column appears at all.
   */
  pending?: PendingBoardState | null;
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
  /** The community's colour for the state, else a role its semantic implies. */
  color: string;
  /** The records somebody arranged here, in that order, minus any stale hint. */
  arranged: CardRow[];
  /** The records this column's state gathers that nobody has positioned. Empty for a lane. */
  unarranged: CardRow[];
  count: number;
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
}

/** The shape a state's heading takes when the community has not picked one. */
export const SEMANTIC_ICON: Record<string, string> = {
  open: 'circle',
  active: 'circle-half',
  blocked: 'warning-circle',
  done: 'check-circle',
  cancelled: 'x-circle',
};

/** And the colour role — a role rather than a scale position, so a theme can redesign it. */
export const SEMANTIC_COLOR: Record<string, string> = {
  open: 'text-muted',
  active: 'accent-text',
  blocked: 'warning-text',
  done: 'success-text',
  cancelled: 'text-faint',
};

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
      icon: slug ? state?.icon || SEMANTIC_ICON[semantic] || 'circle' : '',
      color: slug ? state?.color || SEMANTIC_COLOR[semantic] || 'text-muted' : 'text-muted',
      arranged,
      unarranged,
      count: arranged.length + unarranged.length,
    };
  }

  const unplaced = pool.filter((r) => !placed.has(r.id) && !boundSlugs.has(statusOf(r) ?? ''));
  const seen = new Set<string>();
  const unplacedStates: { slug: string; name: string }[] = [];
  for (const record of unplaced) {
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
  };
}
