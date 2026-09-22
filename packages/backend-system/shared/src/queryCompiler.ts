/**
 * The query compiler: the flat `$query` shape ⇄ the neutral `QueryIR`.
 *
 * `compileQuery` lifts the flat, post-resolution `$query` (the neutral authoring DSL — `entity`
 * mapped to `model`, plus `where`/`order`/`include`/`limit`) up into the IR. `irToFlatQuery` is the
 * inverse: it lowers the IR back down to the flat query dialect a `EntityClass` ORM consumes (AD4M's
 * `Ad4mModel.query`, the in-memory harness backend). Both are neutral — the AD4M-*specific* pieces
 * (capability profile, scope→predicate resolution) live in the adapter that composes these.
 *
 * `compileQuery` returns the IR *and* an `unsupported` list. Most shapes map losslessly — including
 * single/filtered `$`-projections (→ an aliased `include` with `over`). `unsupported` flags the shapes
 * that don't: `parent` drill-down (a neutral `scope` needs the anchor *type*, which neither flat form
 * carries — see the gap-handling note in the portability docs), a nested count-projection, and
 * `offset` without `limit`. Surfacing them as data rather than mis-translating silently is deliberate.
 *
 * Reference for the flat `$query` grammar: the `$query` docs in `CLAUDE.md`.
 */
import type { Aggregation, Filter, IncludeMap, IncludeSpec, Op, QueryIR, Scalar, Scope, SortKey } from './queryIR';
import { RANGE_OPS } from './rangeCompare';

export interface FlatQuery {
  entity: string;
  where?: Record<string, unknown>;
  order?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  offset?: number;
  include?: Record<string, unknown>;
  /** Neutral drill-down; passed straight to the IR, resolved to a backend handle by the adapter. */
  scope?: Scope;
  subscribe?: boolean;
  [k: string]: unknown;
}

export interface CompileResult {
  ir: QueryIR;
  /** Flat-query features that don't map losslessly and would need a design decision to support. */
  unsupported: string[];
}

// ─── where → Filter tree ────────────────────────────────────────────────────────

/**
 * One key of a flat `where` — a scalar comparison, or a quantifier over a relation.
 *
 * The two are told apart by the **operator name**, not by asking the manifest whether the key names
 * a relation: this compiler takes no manifest, and threading one in to answer a question the
 * operator already answers would put the same knowledge in two places. So `some`/`none` are what
 * make a key a relation quantifier, and a scalar property can never be compared with them.
 *
 * `exists` deliberately stays a scalar operator even against a relation, where it keeps meaning what
 * it always has. On a to-many that is very nearly `some: {}`, and the overlap is harmless — an
 * author reaching for a quantifier writes the quantifier.
 */
function leafCondition(field: string, cond: unknown): Filter {
  if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
    const c = cond as Record<string, unknown>;
    // `{ comments: { some: {} } }` — has at least one; `{ some: { body: 'spam' } }` — has one that
    // matches. An empty clause is "any", so the nested where is dropped rather than compiled to a
    // filter that matches everything.
    for (const op of ['some', 'none'] as const) {
      if (op in c) {
        const nested = c[op];
        const where =
          nested && typeof nested === 'object' && Object.keys(nested).length
            ? translateWhere(nested as Record<string, unknown>)
            : undefined;
        return { rel: field, op, ...(where ? { where } : {}) };
      }
    }
    if ('contains' in c) return { field, op: 'contains', value: c.contains as Scalar };
    // `startsWith`/`endsWith` were in the IR and the engine from the start and unreachable from a
    // flat where clause, so a prefix match fell through to the equality below and compared a field
    // against the operator *object* — matching nothing, silently. A calendar reads a day out of a
    // datetime this way (`startDate startsWith '2026-08-15'`), and read "no events" every time.
    if ('startsWith' in c) return { field, op: 'startsWith', value: c.startsWith as Scalar };
    if ('endsWith' in c) return { field, op: 'endsWith', value: c.endsWith as Scalar };
    if ('exists' in c) return { field, op: 'exists', value: c.exists as Scalar };
    /*
      Range bounds. The IR, the engine and AD4M's executor all had them; the flat grammar did not, so
      `{ dueDate: { lt: '2026-10-01' } }` fell through to the equality below and compared the field
      against the operator object — matching nothing, silently, for every calendar, every price
      filter and every "due this week".

      Several bounds on one field are one range — `{ gte: from, lt: to }` — so they compile to an
      AND of leaves rather than to whichever key happened to be read first. What a bound compares
      against, and why mixed types match nothing, is `rangeCompare`.
    */
    const bounds = RANGE_OPS.filter((op) => op in c).map((op): Filter => ({ field, op, value: c[op] as Scalar }));
    if (bounds.length) return bounds.length === 1 ? bounds[0] : { and: bounds };
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
      clauses.push(leafCondition(key, cond));
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

export function compileQuery(query: FlatQuery): CompileResult {
  const unsupported: string[] = [];
  const ir: QueryIR = { irVersion: 1, entity: query.entity };

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
  // `scope` (neutral drill-down) passes straight through; the adapter resolves `via` to a backend
  // handle (AD4M: the relation's predicate).
  if (query.scope) ir.scope = query.scope;
  // subscribe defaults true → live default; only record the explicit one-shot case.
  if (query.subscribe === false) ir.live = false;

  return { ir, unsupported };
}

// ─── IR → flat $query (the inverse; lower the IR to the flat EntityClass dialect) ──
//
// A `EntityClass` ORM (AD4M's `Ad4mModel.query`/`findAll`, the in-memory harness backend) speaks the
// flat `$query` dialect (`{ where, order, limit, offset, include, parent }`), so lowering the IR is
// just this projection back to it. It only emits shapes that dialect expresses; a feature it can't (a
// non-native operator, a relation `exists`, a non-`count` aggregate) throws, because the adapter
// should have routed that to the compute-up fallback via `planQuery` rather than pushing it down.
// Round-tripping `flat → IR → flat` re-derives the identical IR — the losslessness guarantee this rests on.

/** A filter leaf's operator → the flat where-condition value for its field. */
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
    case 'startsWith':
      return { startsWith: value };
    case 'endsWith':
      return { endsWith: value };
    case 'exists':
      return { exists: value };
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
      return { [op]: value };
    default:
      throw new Error(`irToFlatQuery: operator "${op}" is not expressible in the flat where clause`);
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
        // Two bounds on one field are one range, `{ gte, lt }`, which is how they arrived — so they
        // merge back into one operator object rather than forcing the explicit AND form.
        if (k in merged && isOperatorObject(merged[k]) && isOperatorObject(part[k]) && disjoint(merged[k], part[k])) {
          merged[k] = { ...(merged[k] as object), ...(part[k] as object) };
          continue;
        }
        if (k in merged) collision = true;
        merged[k] = part[k];
      }
    }
    return collision ? { AND: parts } : merged;
  }
  if ('or' in filter) return { OR: filter.or.map(whereFromFilter) };
  if ('not' in filter) return { NOT: whereFromFilter(filter.not) };
  if ('rel' in filter) {
    // `exists` has no flat quantifier spelling of its own — it is the scalar operator, which a flat
    // where reaches by naming the field directly. Only `some`/`none` round-trip through here.
    if (filter.op === 'exists') {
      throw new Error('irToFlatQuery: a relation `exists` filter has no flat spelling — use `some`');
    }
    return { [filter.rel]: { [filter.op]: filter.where ? whereFromFilter(filter.where) : {} } };
  }
  return { [filter.field]: conditionFromLeaf(filter.op, filter.value) };
}

function isOperatorObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.keys(value).every((k) => (RANGE_OPS as readonly string[]).includes(k))
  );
}

function disjoint(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return Object.keys(b).every((k) => !(k in a));
}

function orderFromSort(sort: SortKey[]): Record<string, 'asc' | 'desc'> {
  const order: Record<string, 'asc' | 'desc'> = {};
  for (const key of sort) order[key.by] = key.dir;
  return order;
}

function flatIncludeEntry(spec: IncludeSpec): Record<string, unknown> {
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
  if (spec.include) out.include = flatIncludeFromMap(spec.include);
  return out;
}

function flatIncludeFromMap(include: IncludeMap): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(include)) {
    out[key] = spec === true ? true : flatIncludeEntry(spec);
  }
  return out;
}

/** Lower a `QueryIR` to the flat `$query` dialect a `EntityClass` ORM consumes. */
export function irToFlatQuery(ir: QueryIR): FlatQuery {
  const flat: FlatQuery = { entity: ir.entity };
  if (ir.filter) flat.where = whereFromFilter(ir.filter);
  if (ir.sort) flat.order = orderFromSort(ir.sort);
  if (ir.page && 'limit' in ir.page) {
    flat.limit = ir.page.limit;
    if ('offset' in ir.page && ir.page.offset !== undefined) flat.offset = ir.page.offset;
  }

  // `include` is reconstructed from plain/aliased includes plus count aggregates (which lived there).
  const include: Record<string, unknown> = {};
  if (ir.include) Object.assign(include, flatIncludeFromMap(ir.include));
  for (const agg of ir.aggregate ?? []) {
    if (agg.fn !== 'count') {
      throw new Error(`irToFlatQuery: aggregate fn "${agg.fn}" has no flat projection (only count does)`);
    }
    const entry: Record<string, unknown> = { from: agg.over, count: true };
    if (agg.filter) entry.where = whereFromFilter(agg.filter);
    include[agg.as] = entry;
  }
  if (Object.keys(include).length) flat.include = include;

  if (ir.scope) {
    // A drill-down can't be compiled to the AD4M dialect here: resolving `scope.via` to a backend
    // handle (an AD4M predicate) needs the manifest binding, which is the adapter's job. The AD4M
    // adapter resolves `scope` to a `ParentScope` itself and attaches it; this translator handles only
    // the binding-free parts.
    throw new Error('irToFlatQuery: scope (drill-down) requires adapter binding resolution, not this translator');
  }
  if (ir.live === false) flat.subscribe = false;
  return flat;
}
