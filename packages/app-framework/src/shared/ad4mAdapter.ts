/**
 * The AD4M query adapter — capability declaration (and, later, the `DataSource` wiring).
 *
 * AD4M's `Ad4mModel.query`/`findAll` already speak the flat `$query` dialect, so "compiling" a
 * `QueryIR` to AD4M is just `irToAd4mQuery` (in `@we/schema-shared`). This declares what AD4M does
 * *natively*, so `planQuery` routes anything it can't to the compute-up fallback (`executeQueryIR`)
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
import type { AdapterCapabilities } from '@we/schema-shared';

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
