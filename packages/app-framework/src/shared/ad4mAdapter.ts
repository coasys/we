/**
 * The AD4M query adapter — the {@link QueryAdapter} the renderer routes every `QueryIR` through.
 *
 * AD4M's `Ad4mModel.query`/`findAll` speak the flat `$query` dialect, so lowering a `QueryIR` to AD4M
 * is just the neutral `irToFlatQuery` (in `@we/schema-shared`). What's AD4M-*specific* — and lives
 * here, not in the agnostic renderer — is the capability profile (`ad4mCapabilities`) plus the two
 * conditional degradations that no capability boolean can express (see `plan` below). `planQuery`
 * uses the profile to route anything AD4M can't push down to the compute-up fallback (`executeQueryIR`)
 * instead of silently mis-executing it.
 *
 * What's native (verified against AD4M's `Where`/`Order` types and coasys/ad4m #867/#868):
 * - Scalar operators eq / not(→ne,nin) / lt / lte / gt / gte / contains, plus OR/AND/NOT combinators.
 * - `include` (nested), `count` projections, `parent` drill-down (`scope`).
 * - Sort by property, by a relation path, and by a projection count — but **one sort key only**
 *   (the SPARQL pagination pushdown is single-key), and only with a `limit`/`offset`.
 *
 * Deliberately routed to the compute-up fallback (not native):
 * - `startsWith`/`endsWith` operators, sum/min/max/avg aggregates, and — the confirmed gap —
 *   **filtering by a related model's property** (`{ rel, some/none }`): AD4M's `where` has no
 *   relation quantifier, so `relationFilters` is false.
 *
 * Two documented caveats aren't clean capability booleans (conditional degradations handled at the
 * wiring step): a projection / relation-path sort silently needs a `limit`, and OR/AND/NOT in `where`
 * disables AD4M's sort/pagination pushdown.
 */
import type {
  AdapterCapabilities,
  CapabilityGap,
  Filter,
  QueryAdapter,
  QueryIR,
  QueryOptions,
  QueryPlan,
} from '@we/schema-shared';
import { irToFlatQuery, planQuery } from '@we/schema-shared';

export const ad4mCapabilities: AdapterCapabilities = {
  operators: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'nin', 'contains', 'exists'],
  booleanCombinators: true, // OR / AND / NOT in `where` (#868)
  relationFilters: false, // no native relation quantifier — the confirmed gap
  scope: true, // drill-down via `parent`
  include: { supported: true }, // nested include is a core ORM feature
  aggregate: ['count'], // count projections only; sum/min/max/avg → compute-up
  sort: { multiKey: false, byRelationPath: true, byAggregate: true }, // single sort key only (#867)
  pagination: ['offset'], // limit / offset; no stable cursor
  live: 'push', // perspective link subscriptions
};

/** Does this filter tree use an OR/AND/NOT combinator anywhere? (AD4M drops its sort pushdown if so.) */
function hasBooleanCombinator(filter: Filter | undefined): boolean {
  if (!filter) return false;
  if ('and' in filter || 'or' in filter || 'not' in filter) return true;
  if ('rel' in filter) return hasBooleanCombinator(filter.where);
  return false;
}

/** A sort key AD4M can only push down with a `limit`: a projection-count or a relation-path sort. */
function sortNeedsLimit(by: string, aggregateAliases: Set<string>): boolean {
  return aggregateAliases.has(by) || by.includes('.');
}

/**
 * The AD4M {@link QueryAdapter}. `lower` is the neutral `irToFlatQuery`; `plan` is `planQuery` over
 * `ad4mCapabilities` plus AD4M's two conditional degradations, which no capability boolean captures:
 * OR/AND/NOT in `where` disables the SPARQL sort/pagination pushdown, and a projection/relation-path
 * sort silently no-ops without a `limit`. Flagging them `compute-up` is what lets the wiring finish
 * such queries in JS instead of returning a wrongly-ordered page.
 */
export const ad4mQueryAdapter: QueryAdapter = {
  capabilities: ad4mCapabilities,

  plan(ir: QueryIR): QueryPlan {
    const base = planQuery(ir, ad4mCapabilities);
    const gaps: CapabilityGap[] = [...base.gaps];
    if (ir.sort?.length) {
      if (hasBooleanCombinator(ir.filter)) {
        gaps.push({
          feature: 'sort:under-boolean',
          path: 'sort',
          disposition: 'compute-up',
          note: 'AD4M disables sort/pagination pushdown when where uses OR/AND/NOT',
        });
      }
      const aggregateAliases = new Set((ir.aggregate ?? []).map((a) => a.as));
      if (!ir.page && ir.sort.some((k) => sortNeedsLimit(k.by, aggregateAliases))) {
        gaps.push({
          feature: 'sort:needs-limit',
          path: 'sort',
          disposition: 'compute-up',
          note: 'projection/relation-path sort needs a limit to push down',
        });
      }
    }
    return { runnable: base.runnable && !gaps.some((g) => g.disposition === 'unsupported'), gaps };
  },

  lower(ir: QueryIR): QueryOptions {
    // `model` is selected via getModel(entity) separately; the options carry only the query.
    const { model: _model, ...opts } = irToFlatQuery(ir);
    void _model;
    return opts as QueryOptions;
  },
};
