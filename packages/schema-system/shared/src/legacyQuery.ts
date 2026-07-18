/**
 * Translate the current AD4M-flavored `$query` into the neutral `QueryIR`. A back-compat translator:
 * existing templates keep their `$query` syntax and this maps it to the IR under the hood.
 *
 * It returns the IR *and* an `unsupported` list. Most legacy shapes map losslessly — including
 * single/filtered `$`-projections (→ an aliased `include` with `over`). `unsupported` flags the shapes
 * that don't: `parent` drill-down (a neutral `scope` needs the anchor *type*, which neither legacy
 * form carries — see the gap-handling note in the portability docs), a nested count-projection, and
 * `offset` without `limit`. Surfacing them as data rather than mis-translating silently is deliberate.
 *
 * Reference for the legacy grammar: the `$query` docs in `CLAUDE.md`.
 */
import type { Aggregation, Filter, IncludeMap, IncludeSpec, Op, QueryIR, Scalar, SortKey } from './queryIR';

export interface LegacyQuery {
  model: string;
  where?: Record<string, unknown>;
  order?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  offset?: number;
  include?: Record<string, unknown>;
  /**
   * Drill-down. `{ id, relation }` is the documented form; `{ id, predicate }` is the AD4M-physical
   * escape hatch some templates use because the relation form never resolved end-to-end. Neither
   * carries the anchor *type* a neutral `scope` needs, so the translator flags both.
   */
  parent?: { id: unknown; relation: string } | { id: unknown; predicate: string };
  perspective?: string;
  subscribe?: boolean;
  [k: string]: unknown;
}

export interface LegacyTranslation {
  ir: QueryIR;
  /** Legacy features that don't map losslessly and would need a design decision to support. */
  unsupported: string[];
}

// ─── where → Filter tree ────────────────────────────────────────────────────────

function fieldCondition(field: string, cond: unknown): Filter {
  if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
    const c = cond as Record<string, unknown>;
    if ('contains' in c) return { field, op: 'contains', value: c.contains as Scalar };
    if ('exists' in c) return { field, op: 'exists', value: c.exists as Scalar };
    if ('not' in c) {
      const v = c.not;
      return Array.isArray(v) ? { field, op: 'nin', value: v as Scalar[] } : { field, op: 'ne', value: v as Scalar };
    }
  }
  return Array.isArray(cond)
    ? { field, op: 'in', value: cond as Scalar[] }
    : { field, op: 'eq', value: cond as Scalar };
}

function translateWhere(where: Record<string, unknown>): Filter | undefined {
  const clauses: Filter[] = [];
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'OR') {
      clauses.push({ or: (cond as Record<string, unknown>[]).map(translateWhere).filter(Boolean) as Filter[] });
    } else if (key === 'AND') {
      clauses.push({ and: (cond as Record<string, unknown>[]).map(translateWhere).filter(Boolean) as Filter[] });
    } else if (key === 'NOT') {
      const f = translateWhere(cond as Record<string, unknown>);
      if (f) clauses.push({ not: f });
    } else {
      clauses.push(fieldCondition(key, cond));
    }
  }
  if (clauses.length === 0) return undefined;
  return clauses.length === 1 ? clauses[0] : { and: clauses };
}

// ─── order → SortKey[] ──────────────────────────────────────────────────────────

function translateOrder(order: Record<string, 'asc' | 'desc'>): SortKey[] {
  return Object.entries(order).map(([by, dir]) => ({ by, dir }));
}

// ─── include → IncludeMap + top-level aggregates ────────────────────────────────

function translateIncludeSpec(spec: Record<string, unknown>, path: string, unsupported: string[]): IncludeSpec {
  const out: IncludeSpec = {};
  if (spec.where) out.filter = translateWhere(spec.where as Record<string, unknown>);
  if (spec.order) out.sort = translateOrder(spec.order as Record<string, 'asc' | 'desc'>);
  if (spec.limit != null) {
    out.page = { limit: spec.limit as number, ...(spec.offset != null ? { offset: spec.offset as number } : {}) };
  }
  if (spec.select) out.select = spec.select as string[];
  if (spec.include) {
    const nested = translateInclude(spec.include as Record<string, unknown>, `${path}.include`, unsupported);
    if (Object.keys(nested.map).length) out.include = nested.map;
    if (nested.aggregates.length)
      unsupported.push(`${path}.include: nested count-projection (IncludeSpec has no aggregate)`);
  }
  return out;
}

function translateInclude(
  include: Record<string, unknown>,
  path: string,
  unsupported: string[],
): { map: IncludeMap; aggregates: Aggregation[] } {
  const map: IncludeMap = {};
  const aggregates: Aggregation[] = [];
  for (const [key, val] of Object.entries(include)) {
    if (key.startsWith('$')) {
      const spec = (val ?? {}) as Record<string, unknown>;
      if (spec.count === true) {
        // count projection → a top-level aggregate. Alias keeps the `$` so `$item.$x` reads still work.
        aggregates.push({
          as: key,
          over: spec.from as string,
          fn: 'count',
          ...(spec.where ? { filter: translateWhere(spec.where as Record<string, unknown>) } : {}),
        });
      } else {
        // single/filtered projection ($myLike) → an aliased include over the `from` relation. The
        // `$`-key is kept as the alias so `$item.$myLike` reads are unchanged; `limit: 1` → `first`.
        const aliasSpec: IncludeSpec = { over: spec.from as string };
        if (spec.where) aliasSpec.filter = translateWhere(spec.where as Record<string, unknown>);
        if (spec.order) aliasSpec.sort = translateOrder(spec.order as Record<string, 'asc' | 'desc'>);
        if (spec.select) aliasSpec.select = spec.select as string[];
        if (spec.limit === 1) aliasSpec.first = true;
        else if (spec.limit != null) aliasSpec.page = { limit: spec.limit as number };
        map[key] = aliasSpec;
      }
      continue;
    }
    if (val === true) {
      map[key] = true;
    } else {
      map[key] = translateIncludeSpec(val as Record<string, unknown>, `${path}.${key}`, unsupported);
    }
  }
  return { map, aggregates };
}

// ─── top level ──────────────────────────────────────────────────────────────────

export function translateLegacyQuery(query: LegacyQuery): LegacyTranslation {
  const unsupported: string[] = [];
  const ir: QueryIR = { irVersion: 1, entity: query.model };

  if (query.where) {
    const filter = translateWhere(query.where);
    if (filter) ir.filter = filter;
  }
  if (query.order) ir.sort = translateOrder(query.order);
  if (query.limit != null) {
    ir.page = { limit: query.limit, ...(query.offset != null ? { offset: query.offset } : {}) };
  } else if (query.offset != null) {
    unsupported.push('offset without limit');
  }
  if (query.include) {
    const { map, aggregates } = translateInclude(query.include, 'include', unsupported);
    if (Object.keys(map).length) ir.include = map;
    if (aggregates.length) ir.aggregate = aggregates;
  }
  // subscribe defaults true → live default; only record the explicit one-shot case.
  if (query.subscribe === false) ir.live = false;
  // `parent` → a neutral `scope` drill-down needs the anchor's *type* to resolve the relation to a
  // backend handle (e.g. an AD4M predicate). Neither legacy form carries it — `{ id, relation }` has
  // only the relation name, `{ id, predicate }` is an AD4M-physical escape hatch — so flag rather than
  // mis-translate. Migrating a drill-down to `scope: { anchor, via }` clears this.
  if (query.parent) {
    unsupported.push('parent (drill-down): a neutral scope needs the anchor type — migrate to scope: { anchor, via }');
  }
  // `perspective` is intentionally dropped — the dataset handle is injected, not part of the IR.

  return { ir, unsupported };
}

// ─── IR → legacy $query (the inverse; what the AD4M adapter compiles to) ─────────
//
// AD4M's `Ad4mModel.query`/`findAll` already speak the legacy `$query` dialect (`{ where, order,
// limit, offset, include, parent }`), so the "AD4M adapter" is just this projection back to it. It
// only emits shapes AD4M expresses natively; a feature it can't (a non-native operator, a to-many
// relation filter, a non-`count` aggregate) throws, because the runtime should have routed that to
// the compute-up fallback via `planQuery` rather than trying to push it down. Round-tripping
// `legacy → IR → legacy` re-derives the identical IR — the losslessness guarantee this rests on.

/** A filter leaf's operator → the legacy where-condition value for its field. */
function conditionFromLeaf(op: Op, value: Scalar | Scalar[]): unknown {
  switch (op) {
    case 'eq':
    case 'in':
      return value; // {field: scalar} / {field: [array]}
    case 'ne':
    case 'nin':
      return { not: value };
    case 'contains':
      return { contains: value };
    case 'exists':
      return { exists: value };
    default:
      throw new Error(`irToLegacyQuery: operator "${op}" is not expressible in a legacy where clause`);
  }
}

function whereFromFilter(filter: Filter): Record<string, unknown> {
  if ('and' in filter) {
    // Prefer sibling-key merge (the common implicit-AND form); fall back to explicit AND on collision.
    const parts = filter.and.map(whereFromFilter);
    const merged: Record<string, unknown> = {};
    let collision = false;
    for (const part of parts) {
      for (const k of Object.keys(part)) {
        if (k in merged) collision = true;
        merged[k] = part[k];
      }
    }
    return collision ? { AND: parts } : merged;
  }
  if ('or' in filter) return { OR: filter.or.map(whereFromFilter) };
  if ('not' in filter) return { NOT: whereFromFilter(filter.not) };
  if ('rel' in filter) {
    throw new Error('irToLegacyQuery: relation filters are not expressible in a legacy where clause');
  }
  return { [filter.field]: conditionFromLeaf(filter.op, filter.value) };
}

function orderFromSort(sort: SortKey[]): Record<string, 'asc' | 'desc'> {
  const order: Record<string, 'asc' | 'desc'> = {};
  for (const key of sort) order[key.by] = key.dir;
  return order;
}

function legacyIncludeEntry(spec: IncludeSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (spec.over) out.from = spec.over; // aliased projection: relation source
  if (spec.filter) out.where = whereFromFilter(spec.filter);
  if (spec.sort) out.order = orderFromSort(spec.sort);
  if (spec.select) out.select = spec.select;
  if (spec.first) out.limit = 1;
  else if (spec.page && 'limit' in spec.page) {
    out.limit = spec.page.limit;
    if ('offset' in spec.page && spec.page.offset !== undefined) out.offset = spec.page.offset;
  }
  if (spec.include) out.include = legacyIncludeFromMap(spec.include);
  return out;
}

function legacyIncludeFromMap(include: IncludeMap): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(include)) {
    out[key] = spec === true ? true : legacyIncludeEntry(spec);
  }
  return out;
}

/** Compile a `QueryIR` back to the legacy `$query` dialect the AD4M ORM consumes. */
export function irToLegacyQuery(ir: QueryIR): LegacyQuery {
  const legacy: LegacyQuery = { model: ir.entity };
  if (ir.filter) legacy.where = whereFromFilter(ir.filter);
  if (ir.sort) legacy.order = orderFromSort(ir.sort);
  if (ir.page && 'limit' in ir.page) {
    legacy.limit = ir.page.limit;
    if ('offset' in ir.page && ir.page.offset !== undefined) legacy.offset = ir.page.offset;
  }

  // `include` is reconstructed from plain/aliased includes plus count aggregates (which lived there).
  const include: Record<string, unknown> = {};
  if (ir.include) Object.assign(include, legacyIncludeFromMap(ir.include));
  for (const agg of ir.aggregate ?? []) {
    if (agg.fn !== 'count') {
      throw new Error(`irToLegacyQuery: aggregate fn "${agg.fn}" has no legacy projection (only count does)`);
    }
    const entry: Record<string, unknown> = { from: agg.over, count: true };
    if (agg.filter) entry.where = whereFromFilter(agg.filter);
    include[agg.as] = entry;
  }
  if (Object.keys(include).length) legacy.include = include;

  if (ir.scope) {
    // A drill-down can't be compiled to the legacy dialect here: resolving `scope.via` to a backend
    // handle (an AD4M predicate) needs the manifest binding, which is the adapter's job. The AD4M
    // adapter resolves `scope` to a `ParentScope` itself and attaches it; this translator handles only
    // the binding-free parts.
    throw new Error('irToLegacyQuery: scope (drill-down) requires adapter binding resolution, not this translator');
  }
  if (ir.live === false) legacy.subscribe = false;
  return legacy;
}
