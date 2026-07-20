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
 * Two documented caveats aren't clean capability booleans, and aren't capability gaps at all — they
 * are **AD4M bugs**: an explicit OR/AND/NOT in `where` disables its sort/pagination pushdown, and a
 * projection / relation-path sort silently needs a `limit`. In both cases AD4M returns the correct
 * rows and simply ignores the ordering, so they are reported as `degraded` (run + warn), not
 * `compute-up` (which would fail loud until something computed them up) — see {@link Disposition}.
 * The real fix is upstream in AD4M; when it lands, grep `sort:under-boolean` / `sort:needs-limit`
 * and delete these two blocks.
 */
import type {
  AdapterCapabilities,
  CapabilityGap,
  QueryAdapter,
  QueryIR,
  QueryOptions,
  QueryPlan,
  Scope,
} from '@we/schema-shared';
import { irToFlatQuery, planQuery, whereUsesCombinator } from '@we/schema-shared';

import type { ModelManifestEntry } from './AdamStore';

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

/** A sort key AD4M can only push down with a `limit`: a projection-count or a relation-path sort. */
function sortNeedsLimit(by: string, aggregateAliases: Set<string>): boolean {
  return aggregateAliases.has(by) || by.includes('.');
}

/**
 * Resolve a neutral drill-down to AD4M's `parent` handle (the Tier-2 "adapter-rewrite"): find the
 * anchor entity's `via` relation in the perspective's model manifest and read its RDF `predicate`,
 * then hand AD4M the `{ id, predicate }` form directly — which sidesteps AD4M's own relation-name
 * resolver (`resolveParentPredicate`, broken for synced dynamic models). The predicate is available on
 * every relation (WE + synced) via `ModelManifestProperty.predicate`.
 */
function resolveScopeToParent(models: ModelManifestEntry[], scope: Scope): { id: unknown; predicate: string } {
  const entry = scope.anchor ? models.find((m) => m.name === scope.anchor) : undefined;
  const prop = entry?.properties.find((p) => p.name === scope.via);
  if (!prop?.predicate) {
    throw new Error(
      `ad4mQueryAdapter: cannot resolve scope { anchor: "${scope.anchor}", via: "${scope.via}" } — ` +
        `no such relation in the current perspective's model manifest`,
    );
  }
  return { id: scope.anchorId, predicate: prop.predicate };
}

/**
 * Build the AD4M {@link QueryAdapter}. A factory (not a singleton) because `lower` needs the current
 * perspective's model manifest to resolve a `scope` drill-down — so `getModels` returns the SHACL model
 * entries (including synced ones, e.g. Flux's) at call time.
 *
 * `plan` is `planQuery` over `ad4mCapabilities` plus AD4M's two conditional degradations, which no
 * capability boolean captures: OR/AND/NOT in `where` disables the SPARQL sort/pagination pushdown, and a
 * projection/relation-path sort silently no-ops without a `limit`. `lower` is the neutral `irToFlatQuery`,
 * plus resolving `scope` → `parent` here (AD4M-specific; `irToFlatQuery` throws on `scope` by design).
 */
export function createAd4mQueryAdapter(getModels: () => ModelManifestEntry[]): QueryAdapter {
  return {
    capabilities: ad4mCapabilities,

    plan(ir: QueryIR): QueryPlan {
      const base = planQuery(ir, ad4mCapabilities);
      const gaps: CapabilityGap[] = [...base.gaps];
      if (ir.sort?.length) {
        // Judge this on the *lowered* where, not the IR: an implicit conjunction (sibling `where`
        // keys) compiles to an `and` node but merges back to sibling keys, which AD4M pushes down
        // natively. Only an explicit OR/AND/NOT that survives lowering costs the pushdown.
        if (whereUsesCombinator(ir.filter)) {
          gaps.push({
            feature: 'sort:under-boolean',
            path: 'sort',
            disposition: 'degraded',
            note: 'AD4M returns correct rows but silently ignores the sort when where uses an explicit OR/AND/NOT',
          });
        }
        const aggregateAliases = new Set((ir.aggregate ?? []).map((a) => a.as));
        if (!ir.page && ir.sort.some((k) => sortNeedsLimit(k.by, aggregateAliases))) {
          gaps.push({
            feature: 'sort:needs-limit',
            path: 'sort',
            disposition: 'degraded',
            note: 'AD4M returns correct rows but silently ignores a projection/relation-path sort without a limit',
          });
        }
      }
      return { runnable: base.runnable && !gaps.some((g) => g.disposition === 'unsupported'), gaps };
    },

    lower(ir: QueryIR): QueryOptions {
      // `scope` is AD4M-resolved here (irToFlatQuery throws on it); everything else lowers neutrally.
      // `entity` is selected via getModel(entity) separately, so the options carry only the query.
      const { scope, ...rest } = ir;
      const { entity: _entity, ...opts } = irToFlatQuery(rest);
      void _entity;
      if (scope) {
        (opts as Record<string, unknown>).parent = resolveScopeToParent(getModels(), scope);
      }
      return opts as QueryOptions;
    },
  };
}
