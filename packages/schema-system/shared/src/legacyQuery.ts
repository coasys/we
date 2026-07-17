/**
 * Translate the current AD4M-flavored `$query` into the neutral `QueryIR`. A back-compat translator:
 * existing templates keep their `$query` syntax and this maps it to the IR under the hood.
 *
 * It returns the IR *and* an `unsupported` list. Most legacy shapes map losslessly — including
 * `parent` (→ the `scope` drill-down) and single/filtered `$`-projections (→ an aliased `include`
 * with `over`). `unsupported` now holds only genuinely degenerate shapes (a nested count-projection,
 * `offset` without `limit`); surfacing them as data rather than mis-translating silently is deliberate.
 *
 * Reference for the legacy grammar: the `$query` docs in `CLAUDE.md`.
 */
import type { Aggregation, Filter, IncludeMap, IncludeSpec, QueryIR, Scalar, SortKey } from './queryIR';

export interface LegacyQuery {
  model: string;
  where?: Record<string, unknown>;
  order?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  offset?: number;
  include?: Record<string, unknown>;
  parent?: { id: unknown; relation: string };
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
  // `parent` → the neutral `scope` drill-down. Legacy carries no anchor *type* (AD4M resolves it by
  // id at runtime), so `anchor` is left unset — validation of `via` is skipped, execution resolves it.
  if (query.parent) ir.scope = { via: query.parent.relation, anchorId: query.parent.id as string | number };
  // `perspective` is intentionally dropped — the dataset handle is injected, not part of the IR.

  return { ir, unsupported };
}
