/**
 * A reference `QueryIR` execution engine over in-memory rows — the compute-up toolkit that runs a
 * query the way a backend without a native engine would (filter / sort / paginate / hydrate relations
 * / aggregate, all in JS). It proves the IR is executable end-to-end, and doubles as the fallback a
 * weak adapter uses for features it can't push down.
 *
 * Pure and framework-agnostic. Operates on plain rows plus a relation map (target + cardinality +
 * foreign key) — the minimal shape any in-memory dataset can provide.
 */
import type { Aggregation, Filter, IncludeMap, Op, QueryIR, Scalar, SortKey } from './queryIR';

export type Row = Record<string, unknown> & { id: string | number };

export interface InMemoryRelation {
  target: string;
  cardinality: 'one' | 'many';
  /** hasOne: fk on this row → target.id. hasMany: fk on target rows → this row.id. */
  foreignKey: string;
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
      return (actual as number) < (value as number);
    case 'lte':
      return (actual as number) <= (value as number);
    case 'gt':
      return (actual as number) > (value as number);
    case 'gte':
      return (actual as number) >= (value as number);
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
  const targetRows = data.tables[rel.target] ?? [];
  const rows =
    rel.cardinality === 'one'
      ? targetRows.filter((r) => r.id === row[rel.foreignKey])
      : targetRows.filter((r) => r[rel.foreignKey] === row.id);
  return { rows, rel };
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

// ─── include ────────────────────────────────────────────────────────────────────

function hydrate(row: Row, entity: string, include: IncludeMap, data: InMemoryDataset): Row {
  const out: Row = { ...row };
  for (const [relName, spec] of Object.entries(include)) {
    const resolved = relatedRows(row, entity, relName, data);
    if (!resolved) {
      out[relName] = resolved === undefined ? null : [];
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
    out[relName] = asObject ? (rows[0] ?? null) : rows;
  }
  return out;
}

// ─── top level ──────────────────────────────────────────────────────────────────

/** Execute a QueryIR over an in-memory dataset. (Structure/manifest validity is a separate pass.) */
export function executeQueryIR(query: QueryIR, data: InMemoryDataset): Row[] {
  const entity = query.entity;
  let rows = (data.tables[entity] ?? []).slice();

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

  return rows;
}
