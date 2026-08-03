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
import type { PerspectiveProxy } from '@coasys/ad4m';
import type {
  AdapterCapabilities,
  CapabilityGap,
  EphemeralPort,
  ModelClass as RendererModelClass,
  QueryAdapter,
  QueryIR,
  QueryOptions,
  QueryPlan,
  RendererDataBindings,
  Scope,
} from '@we/backend-shared';
import { irToFlatQuery, planQuery, whereUsesCombinator } from '@we/backend-shared';
import { getModel, getModelForPerspective, type ModelClass as Ad4mModelClass } from '@we/models';

import type { ModelManifestEntry } from './manifestTypes';

/**
 * Adapt an AD4M model class to the renderer's neutral {@link RendererModelClass}.
 *
 * `Ad4mModel`'s statics are `query(perspective: PerspectiveProxy, query?: TypedQuery<T>)` — the same
 * two operations the renderer needs, under a backend-specific signature. This is the mapping every
 * host owes the contract: the renderer depends on the *shape* (`query`/`findAll` over a dataset and
 * options), so each backend maps its own onto it.
 *
 * It is a pure signature map with no data conversion, because a dataset handle is opaque to the
 * renderer and round-trips untouched — the `PerspectiveProxy` handed out by `$currentDataset` is the
 * very object arriving back here. (Had the contract insisted on a structural `{ id }` handle, this
 * would instead have to flatten the proxy and re-resolve it on every query.)
 */
export function toRendererModel(Model: Ad4mModelClass): RendererModelClass {
  return {
    query: (dataset, opts) =>
      Model.query(dataset as PerspectiveProxy, opts as Parameters<typeof Model.query>[1]) as ReturnType<
        RendererModelClass['query']
      >,
    findAll: (dataset, opts, ctl) =>
      // Called through a widened signature on purpose: `@coasys/ad4m` types `findAll` as
      // `(perspective, query?)`, with no third argument — yet the renderer passes an abort-signal
      // options object, and both the renderer and WE's own docs describe it as forwarded to the
      // executor's cancel machinery. The published `.d.ts` and the documented runtime disagree.
      // Cast rather than drop it: silently removing the signal would disable cancellation of
      // in-flight queries. Worth confirming against the executor — if it is genuinely unsupported,
      // the abort is already a no-op and the renderer's AbortController buys nothing.
      (Model.findAll as unknown as (p: unknown, q: unknown, c?: unknown) => unknown)(dataset, opts, ctl) as ReturnType<
        RendererModelClass['findAll']
      >,
  };
}

/**
 * What the AD4M adapter needs from the host to satisfy the data contract.
 *
 * Declared structurally rather than as `AdamStore` on purpose: that interface lives under
 * `frameworks/solid/`, and this module is framework-agnostic. Naming the four accessors it actually
 * uses also states the adapter's real dependency surface, and makes it stubbable without a store.
 */
export interface Ad4mAdapterDeps {
  /** The perspective queries run against — handed to the renderer as an opaque dataset handle. */
  currentPerspective: () => PerspectiveProxy | null;
  /** SHACL models of the current perspective, incl. synced foreign ones; used to resolve `scope`. */
  currentPerspectiveModels: () => ModelManifestEntry[];
  /**
   * Reactive agent-profile cache. Must be *read inside* the accessor so `$agent`'s effect re-runs
   * when a fetched profile lands. Typed by the only field this adapter needs — a `did` to match on —
   * rather than the host's concrete profile type, which keeps this module free of app-layer imports.
   */
  agents: () => Array<{ did?: string }>;
  /** Ask AD4M to fetch a profile this client hasn't cached. */
  fetchAgent: (did: string) => Promise<void> | void;
  /**
   * The ephemeral transport (see `ad4mEphemeralAdapter.ts`). Held by the host rather than created
   * here so that a single instance is shared: it refcounts scopes per perspective, which only works
   * if every consumer goes through the same port.
   */
  ephemeralPort: EphemeralPort;
}

/**
 * The AD4M implementation of the renderer's data contract — `RendererDataBindings` minus the members
 * that aren't backend-specific.
 *
 * This is the artifact another backend copies: everything a host must supply for the renderer to read
 * data, in one place. `$onError` and `$useQueryIR` are deliberately excluded — surfacing an error to
 * the UI and toggling the IR are host concerns any backend would wire the same way, so they stay with
 * the app rather than pretending to be AD4M-specific.
 *
 * Note what is *not* here: no query lowering, no capability quirks, no model-shape mapping. Those are
 * `createAd4mQueryAdapter` and `toRendererModel` above — this only composes them.
 */
export function createAd4mDataBindings(
  deps: Ad4mAdapterDeps,
): Pick<
  RendererDataBindings,
  '$getModel' | '$getModelForPerspective' | '$currentDataset' | '$identities' | '$queryAdapter' | '$ephemeral'
> {
  return {
    // Adapted, not raw: AD4M's model statics take a `PerspectiveProxy` and AD4M's own query shape,
    // so `toRendererModel` maps them onto the neutral `query`/`findAll` the renderer depends on.
    $getModel: (name) => toRendererModel(getModel(name)),
    $getModelForPerspective: (name, dataset) => {
      const model = getModelForPerspective(name, dataset);
      return model ? toRendererModel(model) : undefined;
    },
    // The renderer treats this as opaque and hands it straight back, so the proxy passes through
    // untouched — no flattening to an id, no re-resolution on the way in.
    $currentDataset: deps.currentPerspective,
    // Identity directory behind the `$agent` block, bound to AD4M's agent cache.
    $identities: {
      get: (did) => deps.agents().find((a) => a.did === did) as Record<string, unknown> | undefined,
      fetch: (did) => void deps.fetchAgent(did),
    },
    $queryAdapter: createAd4mQueryAdapter(deps.currentPerspectiveModels),
    // Named in the contract so *distributable* code can reach it — a marketplace feature module
    // cannot import this adapter, nor know the name of a host store to call.
    $ephemeral: deps.ephemeralPort,
  };
}

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
