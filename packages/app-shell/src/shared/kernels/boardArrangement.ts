/**
 * The board arrangement: which cards each column of a board shows, in what order, and what is left
 * over. Data in, data out — no stores, no reactivity, no imports — so a second host can implement it
 * against the recorded vectors beside this file (`vectors/boardArrangement.json`) or run it as is.
 *
 * The reasoning is `docs/architecture/boards.md`. In one paragraph: **state is a fact about the work;
 * position is a fact about the pair.** A column bound to a state (`slug`) shows the records whose
 * state matches, in the order its `arranges` lists them, then whatever matches that nobody arranged.
 * A column with no slug is a lane: it shows only what it arranges. A record arranged in a lane is
 * left out of the state columns on this board, or it would show twice. A stale hint — a record a
 * column still lists whose state no longer matches it — counts for nothing, so the card falls back
 * to its state's column rather than vanishing. A board that gathers draws from every record given;
 * one that does not draws only what its columns and the board itself arrange. Unplaced is the work
 * that no column here can show.
 *
 * What the host adds on top — people, a workflow's waiting moves, a heading's icon and colour from
 * the community's vocabulary — is `sources/arrangedBoard.ts`. What it substitutes before calling
 * this — a run's state, a write not yet seen — arrives here as plain data: `statuses` and `orders`.
 *
 * **Identity.** `columns`, `arranged`, `unarranged`, `unplaced` and `available` hold the caller's own
 * objects, never copies: a renderer keying rows by reference would otherwise remount every column on
 * every change.
 */

export interface BoardRow {
  id?: string;
  /** The board's columns, in order — ids or rows carrying one. */
  children?: unknown[];
  /** Cards the board holds in no column. */
  arranges?: unknown[];
  /** What the board draws from; empty for a board that shows only what it holds. */
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
  retired?: boolean;
}

export interface BoardArrangementInput {
  board?: BoardRow | null;
  columns?: ColumnRow[] | null;
  records?: CardRow[] | null;
  states?: StateRow[] | null;
  /** A record's state where it is not its stored `status`, by record id. `''` is a state too. */
  statuses?: Record<string, string> | null;
  /** An order to read in place of the stored one, by record id and then relation (`children`, `arranges`). */
  orders?: Record<string, Record<string, string[]>> | null;
}

/** What one column shows, before the host draws it. */
export interface ArrangedColumn {
  id: string;
  slug: string;
  /** True for a column bound to no state — it positions and never gathers. */
  lane: boolean;
  /** The column's own title, else its state's name, else its slug, else `Untitled`. */
  label: string;
  /** What the column's state means (`open`, `active`, `done` …); `''` for a lane. */
  semantic: string;
  /** The records somebody arranged here, in that order, minus any stale hint. */
  arranged: CardRow[];
  /** The records this column's state gathers that nobody positioned. Empty for a lane. */
  unarranged: CardRow[];
  count: number;
  /** `arranged` then `unarranged`, as ids — the column's whole order. */
  order: string[];
}

export interface BoardArrangement {
  /** A board record has arrived. */
  ready: boolean;
  gathers: boolean;
  /** The caller's column rows, in the board's order; a child no row answers for is skipped. */
  columns: ColumnRow[];
  contents: Record<string, ArrangedColumn>;
  /** Work in scope that no column here shows. */
  unplaced: CardRow[];
  /** The states the unplaced work is in, each once, in the order first met. */
  unplacedStates: { slug: string; name: string }[];
  /** Records given that this board draws nowhere. */
  available: CardRow[];
  choices: { id: string; label: string }[];
  /** States offered (not retired) that no column here is bound to. */
  unboundStates: { slug: string; name: string }[];
  /** How many records were given. */
  total: number;
}

/** A relation as ids, from ids or rows carrying one. */
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
const own = (object: object | null | undefined, key: string) =>
  !!object && Object.prototype.hasOwnProperty.call(object, key);

export function arrangeBoard(input: BoardArrangementInput | null | undefined): BoardArrangement {
  const board = input?.board ?? null;
  const columnRows = asRows<ColumnRow>(input?.columns).filter((c) => c && typeof c.id === 'string');
  const records = asRows<CardRow>(input?.records).filter((r) => r && typeof r.id === 'string');
  const states = asRows<StateRow>(input?.states);
  const statuses = input?.statuses ?? null;
  const orders = input?.orders ?? null;

  const orderOf = (id: string | undefined, relation: string, stored: unknown): string[] => {
    const held = id && own(orders, id) ? orders![id] : null;
    return held && own(held, relation) && Array.isArray(held[relation]) ? held[relation] : idsOf(stored);
  };
  const arrangesOf = (record: { id?: string; arranges?: unknown } | null) =>
    orderOf(record?.id, 'arranges', record?.arranges);
  const statusOf = (record: CardRow): string | undefined =>
    own(statuses, record.id) ? statuses![record.id] : record.status;

  const ready = Boolean(board && typeof board === 'object' && board.id);
  const gathers = Boolean(ready && board?.gathers);

  const byId = new Map(columnRows.map((c) => [c.id, c]));
  const columns = ready
    ? orderOf(board?.id, 'children', board?.children)
        .map((id) => byId.get(id))
        .filter((c): c is ColumnRow => Boolean(c))
    : [];

  const recordById = new Map(records.map((r) => [r.id, r]));
  const stateBySlug = new Map(states.filter((s) => s && s.slug).map((s) => [s.slug, s]));

  const held = new Set<string>();
  for (const column of columns) for (const id of arrangesOf(column)) held.add(id);
  for (const id of arrangesOf(board)) held.add(id);

  const pool = gathers ? records : records.filter((r) => held.has(r.id));

  // Placed somewhere that shows it: a lane it is arranged in, or a bound column whose slug matches.
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

  const contents: Record<string, ArrangedColumn> = {};
  for (const column of columns) {
    const slug = column.slug ?? '';
    const state = slug ? stateBySlug.get(slug) : undefined;
    const arranged = arrangesOf(column)
      .map((id) => recordById.get(id))
      .filter((r): r is CardRow => Boolean(r) && (!slug || statusOf(r!) === slug));
    const unarranged = slug ? pool.filter((r) => statusOf(r) === slug && !placed.has(r.id)) : [];
    contents[column.id] = {
      id: column.id,
      slug,
      lane: !slug,
      label: column.title || state?.name || slug || 'Untitled',
      semantic: slug ? (state?.semantic ?? 'open') : '',
      arranged,
      unarranged,
      count: arranged.length + unarranged.length,
      order: [...arranged, ...unarranged].map((r) => r.id),
    };
  }

  const unplaced = pool.filter((r) => !placed.has(r.id) && !boundSlugs.has(statusOf(r) ?? ''));

  // Everything the board draws — by arrangement or by state — so `available` offers only the rest.
  const shown = new Set<string>(unplaced.map((r) => r.id));
  for (const column of columns) {
    for (const record of contents[column.id].arranged) shown.add(record.id);
    for (const record of contents[column.id].unarranged) shown.add(record.id);
  }

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
    available: records.filter((r) => !shown.has(r.id)),
    choices: columns.map((c) => ({ id: c.id, label: contents[c.id].label })),
    unboundStates: states
      .filter((s) => s && s.slug && !s.retired && !boundSlugs.has(s.slug))
      .map((s) => ({ slug: s.slug, name: s.name || s.slug })),
    total: records.length,
  };
}
