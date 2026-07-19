/**
 * Adapter capabilities + query planning. A backend adapter declares what it can do *natively*; this
 * classifies every feature a query uses as `native`, `compute-up` (not native but derivable in JS by
 * the fallback toolkit over rows the adapter returns), or `unsupported` (can't be faked → fail loud).
 *
 * This is the mechanism behind the L0–L4 tiers and "fail loudly, don't silently return nothing".
 * The compute-up toolkit itself is separate; this only decides the disposition.
 */
import type { Aggregation, Filter, IncludeMap, Op, Page, QueryIR, SortKey } from './queryIR';

export type AggregateFn = Aggregation['fn'];

export interface AdapterCapabilities {
  /** Filter operators supported natively. */
  operators: Op[];
  /** and / or / not nesting in filters. */
  booleanCombinators: boolean;
  /** `{ rel, some/none/exists }` relation-scoped filters. */
  relationFilters: boolean;
  /** Native drill-down from an anchor instance (the IR's `scope`; e.g. AD4M's `parent`). */
  scope: boolean;
  include: { supported: boolean; maxDepth?: number };
  /** Aggregate functions supported natively. */
  aggregate: AggregateFn[];
  sort: { multiKey: boolean; byRelationPath: boolean; byAggregate: boolean };
  pagination: ('offset' | 'cursor')[];
  live: 'none' | 'poll' | 'push';
}

export type Disposition = 'native' | 'compute-up' | 'unsupported';

export interface CapabilityGap {
  /** What isn't native, e.g. "operator:contains", "include", "sort:byAggregate", "pagination:cursor". */
  feature: string;
  path: string;
  disposition: Exclude<Disposition, 'native'>;
  note: string;
}

export interface QueryPlan {
  /** False iff any gap is `unsupported`. */
  runnable: boolean;
  gaps: CapabilityGap[];
}

function analyzeFilter(filter: Filter, cap: AdapterCapabilities, path: string, gaps: CapabilityGap[]): void {
  if ('and' in filter || 'or' in filter || 'not' in filter) {
    if (!cap.booleanCombinators) {
      gaps.push({ feature: 'booleanCombinators', path, disposition: 'compute-up', note: 'and/or/not not native' });
    }
    if ('and' in filter) filter.and.forEach((f, i) => analyzeFilter(f, cap, `${path}.and.${i}`, gaps));
    else if ('or' in filter) filter.or.forEach((f, i) => analyzeFilter(f, cap, `${path}.or.${i}`, gaps));
    else if ('not' in filter) analyzeFilter(filter.not, cap, `${path}.not`, gaps);
    return;
  }
  if ('rel' in filter) {
    if (!cap.relationFilters) {
      gaps.push({
        feature: 'relationFilters',
        path: `${path}.rel`,
        disposition: 'compute-up',
        note: 'relation filters not native',
      });
    }
    if (filter.where) analyzeFilter(filter.where, cap, `${path}.where`, gaps);
    return;
  }
  if (!cap.operators.includes(filter.op)) {
    gaps.push({
      feature: `operator:${filter.op}`,
      path: `${path}.op`,
      disposition: 'compute-up',
      note: `operator "${filter.op}" not native`,
    });
  }
}

function analyzeInclude(
  include: IncludeMap,
  cap: AdapterCapabilities,
  depth: number,
  path: string,
  gaps: CapabilityGap[],
): void {
  if (!cap.include.supported) {
    gaps.push({
      feature: 'include',
      path,
      disposition: 'compute-up',
      note: 'include not native (would N+1 + join in JS)',
    });
  } else if (cap.include.maxDepth !== undefined && depth > cap.include.maxDepth) {
    gaps.push({
      feature: 'include:depth',
      path,
      disposition: 'compute-up',
      note: `include depth ${depth} exceeds native maxDepth ${cap.include.maxDepth}`,
    });
  }
  for (const [rel, spec] of Object.entries(include)) {
    if (spec === true) continue;
    if (spec.filter) analyzeFilter(spec.filter, cap, `${path}.${rel}.filter`, gaps);
    if (spec.include) analyzeInclude(spec.include, cap, depth + 1, `${path}.${rel}.include`, gaps);
  }
}

function analyzeSort(
  sort: SortKey[],
  aggregateAliases: Set<string>,
  cap: AdapterCapabilities,
  path: string,
  gaps: CapabilityGap[],
): void {
  if (sort.length > 1 && !cap.sort.multiKey) {
    gaps.push({ feature: 'sort:multiKey', path, disposition: 'compute-up', note: 'multi-key sort not native' });
  }
  sort.forEach((key, i) => {
    if (aggregateAliases.has(key.by) && !cap.sort.byAggregate) {
      gaps.push({
        feature: 'sort:byAggregate',
        path: `${path}.${i}.by`,
        disposition: 'compute-up',
        note: 'sort by aggregate not native',
      });
    } else if (key.by.includes('.') && !cap.sort.byRelationPath) {
      gaps.push({
        feature: 'sort:byRelationPath',
        path: `${path}.${i}.by`,
        disposition: 'compute-up',
        note: 'sort by relation path not native',
      });
    }
  });
}

function analyzePage(page: Page, cap: AdapterCapabilities, path: string, gaps: CapabilityGap[]): void {
  if ('after' in page && page.after !== undefined) {
    if (!cap.pagination.includes('cursor')) {
      // A stable cursor can't be minted in JS without adapter cooperation → hard fail.
      gaps.push({
        feature: 'pagination:cursor',
        path,
        disposition: 'unsupported',
        note: 'cursor pagination not supported by adapter',
      });
    }
  } else if ('offset' in page && page.offset) {
    if (!cap.pagination.includes('offset')) {
      gaps.push({
        feature: 'pagination:offset',
        path,
        disposition: 'compute-up',
        note: 'offset not native (fetch + slice)',
      });
    }
  }
}

function analyzeLive(cap: AdapterCapabilities, gaps: CapabilityGap[]): void {
  if (cap.live === 'push') return;
  if (cap.live === 'poll') {
    gaps.push({
      feature: 'live:push',
      path: 'live',
      disposition: 'compute-up',
      note: 'no push feed; polling fallback',
    });
  } else {
    gaps.push({
      feature: 'live:none',
      path: 'live',
      disposition: 'unsupported',
      note: 'backend has no change feed; query cannot be live',
    });
  }
}

/** Classify a query's features against an adapter's capabilities. Run after structural + manifest validation. */
export function planQuery(query: QueryIR, cap: AdapterCapabilities): QueryPlan {
  const gaps: CapabilityGap[] = [];
  const aggregateAliases = new Set((query.aggregate ?? []).map((a) => a.as));

  if (query.filter) analyzeFilter(query.filter, cap, 'filter', gaps);
  if (query.include) analyzeInclude(query.include, cap, 1, 'include', gaps);
  (query.aggregate ?? []).forEach((agg: Aggregation, i) => {
    if (!cap.aggregate.includes(agg.fn)) {
      gaps.push({
        feature: `aggregate:${agg.fn}`,
        path: `aggregate.${i}`,
        disposition: 'compute-up',
        note: `aggregate "${agg.fn}" not native`,
      });
    }
    if (agg.filter) analyzeFilter(agg.filter, cap, `aggregate.${i}.filter`, gaps);
  });
  if (query.sort) analyzeSort(query.sort, aggregateAliases, cap, 'sort', gaps);
  if (query.page) analyzePage(query.page, cap, 'page', gaps);
  if (query.scope && !cap.scope) {
    // A backend without native drill-down can still do it compute-up: fetch the entity and filter by
    // the anchor's foreign key.
    gaps.push({ feature: 'scope', path: 'scope', disposition: 'compute-up', note: 'drill-down not native' });
  }
  if (query.live) analyzeLive(cap, gaps);

  return { runnable: !gaps.some((g) => g.disposition === 'unsupported'), gaps };
}
