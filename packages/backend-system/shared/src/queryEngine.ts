/**
 * A reference `QueryIR` execution engine over in-memory rows — the compute-up toolkit that runs a
 * query the way a backend without a native engine would (filter / sort / paginate / hydrate relations
 * / aggregate, all in JS). It proves the IR is executable end-to-end, and doubles as the fallback a
 * weak adapter uses for features it can't push down.
 *
 * Pure and framework-agnostic. Operates on plain rows plus a relation map (target + cardinality +
 * foreign key) — the minimal shape any in-memory dataset can provide.
 */
import type { Aggregation, Filter, IncludeMap, Op, QueryIR, Scalar, Scope, SortKey } from './queryIR';
import { rangeCompare } from './rangeCompare';
import { RECORD_TYPE_KEY } from './recordContract';

export type Row = Record<string, unknown> & { id: string | number };

export interface InMemoryRelation {
  target: string;
  cardinality: 'one' | 'many';
  /** hasOne: fk on this row → target.id. hasMany: fk on target rows → this row.id. */
  foreignKey: string;
  /**
   * The members are in an order somebody chose — see `RelationSchema.ordered`.
   *
   * Membership still comes from the foreign key; this only says that when the parent row carries an
   * id list for the relation, that list decides the sequence. Two facts rather than one, which is
   * what lets a member with no entry in the list still be a member.
   */
  ordered?: boolean;
}

export interface InMemoryDataset {
  tables: Record<string, Row[]>;
  relations?: Record<string, Record<string, InMemoryRelation>>;
}

// ─── operators ──────────────────────────────────────────────────────────────────

function compareOp(actual: unknown, op: Op, value: Scalar | Scalar[], caseSensitive?: boolean): boolean {
  switch (op) {
    case 'eq':
      return actual === value;
    case 'ne':
      return actual !== value;
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
      return rangeCompare(actual, op, value);
    case 'in':
      return Array.isArray(value) && value.includes(actual as Scalar);
    case 'nin':
      return Array.isArray(value) && !value.includes(actual as Scalar);
    case 'exists':
      return value === false ? actual == null : actual != null;
    case 'contains':
    case 'startsWith':
    case 'endsWith': {
      let a = String(actual ?? '');
      let v = String(value ?? '');
      if (!caseSensitive) {
        a = a.toLowerCase();
        v = v.toLowerCase();
      }
      return op === 'contains' ? a.includes(v) : op === 'startsWith' ? a.startsWith(v) : a.endsWith(v);
    }
    default:
      return false;
  }
}

// ─── relations ──────────────────────────────────────────────────────────────────

function relatedRows(
  row: Row,
  entity: string,
  relName: string,
  data: InMemoryDataset,
): { rows: Row[]; rel: InMemoryRelation } | undefined {
  const rel = data.relations?.[entity]?.[relName];
  if (!rel) return undefined;
  // An untyped relation names no target table, which is not the same as having no targets: it means
  // "of any type". A collection holding text, images and embeds is exactly that, and reading it as
  // an empty table made every cover-image projection resolve to null — so a media grid, which drops
  // posts with no image rather than showing blank tiles, rendered as nothing at all.
  // A polymorphic read has to say what each member turned out to be, under the key the record
  // contract names — a consumer holding a mixed bag can do nothing with it otherwise. Free here,
  // where a row's class is simply the table it is in; the structural classification that makes this
  // hard elsewhere has no counterpart.
  const targetRows = rel.target
    ? (data.tables[rel.target] ?? [])
    : Object.entries(data.tables).flatMap(([entity, rows]) =>
        rows.map((r) => (r[RECORD_TYPE_KEY] ? r : { ...r, [RECORD_TYPE_KEY]: entity })),
      );
  const rows =
    rel.cardinality === 'one'
      ? targetRows.filter((r) => r.id === row[rel.foreignKey])
      : targetRows.filter((r) => r[rel.foreignKey] === row.id);
  return { rows: rel.ordered ? inDeclaredOrder(rows, row[relName]) : rows, rel };
}

/**
 * Put a collection's members in the sequence its parent recorded.
 *
 * The parent row already holds the ids in the order they were assigned; membership is decided
 * separately, by the foreign key. Keeping the two apart is what makes this degrade the way the rest
 * of the system does: an id in the list that is no longer a member is inert, and a member the list
 * does not mention is not dropped — it goes to the end, keeping its existing relative position,
 * which is the same answer an unordered read would have given for it.
 *
 * So a collection whose order has never been written reads exactly as it does today, and one whose
 * order is partial reads as "the part somebody arranged, then the rest".
 */
function inDeclaredOrder(rows: Row[], order: unknown): Row[] {
  if (!Array.isArray(order) || !order.length) return rows;
  const position = new Map(order.map((id, i) => [id, i]));
  // Compared rather than subtracted: an unlisted member's position is "after everything listed",
  // and `Infinity - Infinity` is NaN, which would make the comparator incoherent for the very case
  // this has to get right — two members that the order says nothing about. Sort is stable, so
  // returning 0 for that pair is what keeps their existing relative order.
  const at = (r: Row) => position.get(r.id) ?? Number.POSITIVE_INFINITY;
  return [...rows].sort((a, b) => (at(a) === at(b) ? 0 : at(a) < at(b) ? -1 : 1));
}

// ─── filter ─────────────────────────────────────────────────────────────────────

function matchesFilter(row: Row, filter: Filter, entity: string, data: InMemoryDataset): boolean {
  if ('and' in filter) return filter.and.every((f) => matchesFilter(row, f, entity, data));
  if ('or' in filter) return filter.or.some((f) => matchesFilter(row, f, entity, data));
  if ('not' in filter) return !matchesFilter(row, filter.not, entity, data);
  if ('rel' in filter) {
    const resolved = relatedRows(row, entity, filter.rel, data);
    if (!resolved) return false;
    const matched = filter.where
      ? resolved.rows.filter((r) => matchesFilter(r, filter.where!, resolved.rel.target, data))
      : resolved.rows;
    return filter.op === 'none' ? matched.length === 0 : matched.length > 0;
  }
  return compareOp(row[filter.field], filter.op, filter.value, filter.caseSensitive);
}

// ─── sort ───────────────────────────────────────────────────────────────────────

/** Resolve a sort `by` to a comparable value for a row (aggregate alias already attached; to-one path walked). */
function sortValue(row: Row, by: string, entity: string, data: InMemoryDataset): unknown {
  if (!by.includes('.')) return row[by];
  const segments = by.split('.');
  let current: Row | undefined = row;
  let currentEntity = entity;
  for (let i = 0; i < segments.length - 1 && current; i++) {
    const resolved = relatedRows(current, currentEntity, segments[i], data);
    current = resolved?.rows[0];
    currentEntity = resolved?.rel.target ?? currentEntity;
  }
  return current?.[segments[segments.length - 1]];
}

function applySort(rows: Row[], sort: SortKey[], entity: string, data: InMemoryDataset): Row[] {
  return [...rows].sort((a, b) => {
    for (const key of sort) {
      const av = sortValue(a, key.by, entity, data);
      const bv = sortValue(b, key.by, entity, data);
      if (av == null && bv == null) continue;
      if (av == null) return key.nulls === 'first' ? -1 : 1;
      if (bv == null) return key.nulls === 'first' ? 1 : -1;
      if (av === bv) continue;
      const cmp = (av as number) < (bv as number) ? -1 : 1;
      return key.dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

// ─── aggregate ──────────────────────────────────────────────────────────────────

function computeAggregate(row: Row, entity: string, agg: Aggregation, data: InMemoryDataset): number {
  const resolved = relatedRows(row, entity, agg.over, data);
  if (!resolved) return 0;
  const set = agg.filter
    ? resolved.rows.filter((r) => matchesFilter(r, agg.filter!, resolved.rel.target, data))
    : resolved.rows;
  if (agg.fn === 'count') return set.length;
  const values = set.map((r) => Number(r[agg.field!])).filter((n) => !Number.isNaN(n));
  if (values.length === 0) return 0;
  switch (agg.fn) {
    case 'sum':
      return values.reduce((s, n) => s + n, 0);
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    case 'avg':
      return values.reduce((s, n) => s + n, 0) / values.length;
    default:
      return 0;
  }
}

// ─── scope (drill-down) ───────────────────────────────────────────────────────────

/** Restrict rows to those reached from `anchorId` via the anchor's `via` relation. */
function scopeRows(rows: Row[], entity: string, scope: Scope, data: InMemoryDataset): Row[] {
  // Prefer the declared anchor type; otherwise find a relation named `via` that targets this entity.
  let rel = scope.anchor ? data.relations?.[scope.anchor]?.[scope.via] : undefined;
  if (!rel) {
    for (const rels of Object.values(data.relations ?? {})) {
      const cand = rels[scope.via];
      if (cand && cand.target === entity) {
        rel = cand;
        break;
      }
    }
  }
  if (!rel) return []; // unresolvable drill-down → empty (fail closed, never silently return all rows)
  const fk = rel.foreignKey;

  // An empty anchor list is an answer, not an absence: "the children of none of these" is nothing.
  // Treating it as unscoped would return the whole entity, which is the failure worth being
  // deliberate about — it is the one that looks like data rather than like a bug.
  const anchors = (Array.isArray(scope.anchorId) ? scope.anchorId : [scope.anchorId]).map(String);
  const anchorSet = new Set(anchors);

  // `direction: 'in'` asks the opposite question: not "what does this anchor point at" but "what
  // points at it". Here that is the anchors read as rows and their key followed outward.
  const parentOf = (r: Row) => String(r[fk]);
  const idOf = (r: Row) => String(r['id']);
  const matches =
    scope.direction === 'in' ? (r: Row) => anchorSet.has(idOf(r)) : (r: Row) => anchorSet.has(parentOf(r));

  let kept: Row[];
  if (scope.levels && scope.direction !== 'in') {
    // The walk, level by level: each depth keeps `levels[depth]` rows per anchor, and the anchors
    // for the next depth are whatever survived this one. Breadth-first, and deduplicated by id so a
    // node reachable two ways is walked once and a cycle terminates.
    const seen = new Set<string>();
    let frontier = anchorSet;
    kept = [];
    for (const perAnchor of scope.levels) {
      if (frontier.size === 0) break;
      const takenPerAnchor = new Map<string, number>();
      const next = new Set<string>();
      for (const r of rows) {
        const parent = parentOf(r);
        if (!frontier.has(parent)) continue;
        const id = idOf(r);
        if (seen.has(id)) continue;
        const taken = takenPerAnchor.get(parent) ?? 0;
        if (taken >= perAnchor) continue;
        takenPerAnchor.set(parent, taken + 1);
        seen.add(id);
        kept.push(r);
        next.add(id);
      }
      frontier = next;
    }
    return kept;
  }
  if (scope.transitive && scope.direction !== 'in') {
    // Walk down a level at a time until nothing new appears. A real graph store answers this with a
    // path expression; in memory the honest equivalent is the loop, and it terminates on the
    // visited set rather than on depth so a cycle cannot hang it.
    const seen = new Set<string>();
    let frontier = anchorSet;
    kept = [];
    while (frontier.size > 0) {
      const next = new Set<string>();
      for (const r of rows) {
        if (!frontier.has(parentOf(r))) continue;
        const id = idOf(r);
        if (seen.has(id)) continue;
        seen.add(id);
        kept.push(r);
        next.add(id);
      }
      frontier = next;
    }
  } else {
    kept = rows.filter(matches);
  }

  if (scope.limitPerAnchor === undefined) return kept;

  // Per-anchor, in the order the rows already carry — the caller's `sort` has not run yet here, so
  // this mirrors the backend contract rather than promising a "top" N of its own.
  const takenPerAnchor = new Map<string, number>();
  return kept.filter((r) => {
    const key = scope.direction === 'in' ? idOf(r) : parentOf(r);
    const taken = takenPerAnchor.get(key) ?? 0;
    if (taken >= scope.limitPerAnchor!) return false;
    takenPerAnchor.set(key, taken + 1);
    return true;
  });
}

// ─── include ────────────────────────────────────────────────────────────────────

function hydrate(row: Row, entity: string, include: IncludeMap, data: InMemoryDataset): Row {
  const out: Row = { ...row };
  for (const [key, spec] of Object.entries(include)) {
    // Aliased include (`over`) resolves from that relation and attaches under the alias `key`.
    const relName = spec !== true && spec.over ? spec.over : key;
    const resolved = relatedRows(row, entity, relName, data);
    if (!resolved) {
      out[key] = resolved === undefined ? null : [];
      continue;
    }
    let rows = resolved.rows;
    if (spec !== true) {
      if (spec.filter) rows = rows.filter((r) => matchesFilter(r, spec.filter!, resolved.rel.target, data));
      if (spec.sort) rows = applySort(rows, spec.sort, resolved.rel.target, data);
      if (spec.page) {
        const offset = 'offset' in spec.page ? (spec.page.offset ?? 0) : 0;
        rows = rows.slice(offset, offset + spec.page.limit);
      }
      if (spec.include) rows = rows.map((r) => hydrate(r, resolved.rel.target, spec.include!, data));
    }
    const asObject = resolved.rel.cardinality === 'one' || (spec !== true && spec.first === true);
    out[key] = asObject ? (rows[0] ?? null) : rows;
  }
  return out;
}

// ─── top level ──────────────────────────────────────────────────────────────────

/** Execute a QueryIR over an in-memory dataset. (Structure/manifest validity is a separate pass.) */
export function executeQueryIR(query: QueryIR, data: InMemoryDataset): Row[] {
  const entity = query.entity;
  let rows = (data.tables[entity] ?? []).slice();

  if (query.scope) rows = scopeRows(rows, entity, query.scope, data);
  if (query.filter) rows = rows.filter((r) => matchesFilter(r, query.filter!, entity, data));

  for (const agg of query.aggregate ?? []) {
    rows = rows.map((r) => ({ ...r, [agg.as]: computeAggregate(r, entity, agg, data) }));
  }

  if (query.sort) rows = applySort(rows, query.sort, entity, data);

  if (query.page) {
    const offset = 'offset' in query.page ? (query.page.offset ?? 0) : 0;
    rows = rows.slice(offset, offset + query.page.limit);
  }

  if (query.include) rows = rows.map((r) => hydrate(r, entity, query.include!, data));

  // Scalar projection: keep only `id`, the selected props, and derived fields (aggregate aliases +
  // included relations, which `select` never strips). Cursor paging (`page.after`) is intentionally
  // not handled here — a stable cursor is adapter-specific and can't be minted in JS.
  if (query.select) {
    const keep = new Set<string>([
      'id',
      ...query.select,
      ...(query.aggregate ?? []).map((a) => a.as),
      ...Object.keys(query.include ?? {}),
    ]);
    rows = rows.map((r) => {
      const out = {} as Row;
      for (const k of Object.keys(r)) if (keep.has(k)) out[k] = r[k];
      return out;
    });
  }

  return rows;
}
