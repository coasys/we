/**
 * The AD4M query adapter — the {@link QueryAdapter} the renderer routes every `QueryIR` through.
 *
 * AD4M's `Ad4mModel.query`/`findAll` speak the flat `$query` dialect, so lowering a `QueryIR` to AD4M
 * is just the neutral `irToFlatQuery` (in `@we/schema-shared`). What's AD4M-*specific* — and lives
 * here, not in the agnostic renderer — is the capability profile (`ad4mCapabilities`) plus the two
 * conditional degradations that no capability boolean can express (see `plan` below). `planQuery`
 * uses the profile to classify anything AD4M can't push down, so that nothing is silently
 * mis-executed.
 *
 * **What a classification then does is the renderer's business, and only two outcomes exist**, in
 * `compileQueryOptions` (`@we/schema-solid`'s `SchemaRenderer`): a `degraded` gap warns once per
 * entity/feature and runs; *every other* gap calls `onError` and returns null, so the query does not
 * run at all. Read the rest of this file with that in mind — `compute-up` names an *intent* (a gap
 * something could fake in JS) and no such fallback is wired on this path, so it behaves today
 * exactly as `unsupported` does. `executeQueryIR` is the in-memory backend's own engine, not a
 * fallback this adapter reaches for; an earlier version of this comment said otherwise.
 *
 * What's native (read off the executor's own `WhereOps`, where-clause compiler and pagination gate
 * at the pinned build, rather than off a changelog):
 * - Scalar operators eq / not(→ne,nin) / lt / lte / gt / gte / contains, plus OR/AND/NOT combinators.
 * - Relation quantifiers `some` / `none`, which compile to a SPARQL `EXISTS` group.
 * - `include` (nested), `count` projections, `parent` drill-down (`scope`).
 * - Sort by property, by a relation path, and by a projection count — but **one sort key only**
 *   (the SPARQL pagination pushdown is single-key), and the last two only with a `limit`/`offset`.
 *
 * Classified `compute-up` — not native, and so (per the note above) currently refused rather than
 * faked. A template using one gets an error and no rows, which is the honest outcome but not the
 * intended one: `startsWith`/`endsWith` operators, and sum/min/max/avg aggregates.
 *
 * One caveat is not a clean capability boolean and is not a capability gap either — it is an **AD4M
 * bug**: a projection or relation-path sort silently needs a `limit`. The rows come back correct and
 * the ordering is ignored, so it is reported as `degraded` (run + warn) rather than `compute-up`
 * (which, per the note above, refuses) — see {@link Disposition}. The real fix is upstream; when it
 * lands, grep `sort:needs-limit` and delete that block.
 */
import type { PerspectiveProxy } from '@coasys/ad4m';
import type {
  AdapterCapabilities,
  CapabilityGap,
  DatasetHandle,
  EntityClass as RendererEntityClass,
  EphemeralPort,
  QueryAdapter,
  QueryIR,
  QueryOptions,
  QueryPlan,
  RendererDataBindings,
  Scope,
} from '@we/backend-shared';
import { irToFlatQuery, planQuery } from '@we/backend-shared';
import { type EntityClass as Ad4mEntityClass, getEntitiesForPerspective, getEntity } from '@we/entities';

import type { EntityManifestEntry } from './manifestTypes';

/**
 * Adapt an AD4M model class to the renderer's neutral {@link RendererEntityClass}.
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
/**
 * Guard against a host passing a *described* dataset (a `DatasetRef`, which wraps the handle)
 * where the backend's own handle is required. `DatasetHandle` is `unknown` by contract, so the
 * compiler cannot catch this; without the guard the failure surfaces deep inside the SDK as
 * "modelSubscribe is not a function", pointing nowhere near the mistake.
 */
function asPerspective(dataset: DatasetHandle): PerspectiveProxy {
  if (dataset && typeof dataset === 'object' && 'handle' in dataset) {
    throw new Error(
      'AD4M adapter received a DatasetRef where a dataset handle was expected — pass `ref.handle`, not the ref.',
    );
  }
  return dataset as PerspectiveProxy;
}

/**
 * One adapter per model class, so a lookup answers with the same object every time. A new wrapper per
 * `$getEntity` call made every query look like a different model to anything comparing them — the
 * renderer's subscription pool shared nothing because of it.
 */
const rendererEntities = new WeakMap<Ad4mEntityClass, RendererEntityClass>();

export function toRendererEntity(Model: Ad4mEntityClass): RendererEntityClass {
  const known = rendererEntities.get(Model);
  if (known) return known;
  const adapted: RendererEntityClass = {
    query: (dataset, opts) =>
      Model.query(asPerspective(dataset), opts as Parameters<typeof Model.query>[1]) as ReturnType<
        RendererEntityClass['query']
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
        RendererEntityClass['findAll']
      >,
  };
  rendererEntities.set(Model, adapted);
  return adapted;
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
  currentPerspectiveEntities: () => EntityManifestEntry[];
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
 * data, in one place. `$onError` is deliberately excluded — surfacing an error to the UI is a host
 * concern any backend would wire the same way, so it stays with the app rather than pretending to be
 * AD4M-specific.
 *
 * Note what is *not* here: no query lowering, no capability quirks, no model-shape mapping. Those are
 * `createAd4mQueryAdapter` and `toRendererEntity` above — this only composes them.
 */
export function createAd4mDataBindings(
  deps: Ad4mAdapterDeps,
): Pick<
  RendererDataBindings,
  '$getEntity' | '$getEntitiesForPerspective' | '$currentDataset' | '$identities' | '$queryAdapter' | '$ephemeral'
> {
  return {
    // Adapted, not raw: AD4M's model statics take a `PerspectiveProxy` and AD4M's own query shape,
    // so `toRendererEntity` maps them onto the neutral `query`/`findAll` the renderer depends on.
    $getEntity: (name) => toRendererEntity(getEntity(name)),
    $getEntitiesForPerspective: (name, dataset) => {
      const model = getEntitiesForPerspective(name, dataset);
      return model ? toRendererEntity(model) : undefined;
    },
    // The renderer treats this as opaque and hands it straight back, so the proxy passes through
    // untouched — no flattening to an id, no re-resolution on the way in.
    $currentDataset: deps.currentPerspective,
    // Identity directory behind the `$agent` block, bound to AD4M's agent cache.
    $identities: {
      get: (did) => deps.agents().find((a) => a.did === did) as Record<string, unknown> | undefined,
      fetch: (did) => void deps.fetchAgent(did),
    },
    $queryAdapter: createAd4mQueryAdapter(deps.currentPerspectiveEntities),
    // Named in the contract so *distributable* code can reach it — a marketplace feature module
    // cannot import this adapter, nor know the name of a host store to call.
    $ephemeral: deps.ephemeralPort,
  };
}

/**
 * The executor build this profile was established against.
 *
 * Every line below — and both degradations in `plan` — is a **claim about somebody else's
 * software**, checked by nothing at build time. `planQuery` is exact about what WE will do with the
 * answers, and completely credulous about the answers themselves: if a release changes AD4M's sort
 * pushdown, nothing here fails. Skew shows up as *wrong rows in the right shape* — a feed silently
 * in the wrong order, a "top posts" list that is not — which is the failure mode with no error
 * channel at all.
 *
 * There is no handshake to close that gap with: the executor exposes no query-capability report to
 * ask. So the version is recorded instead, next to the claims it belongs to, and the two rules are:
 *
 * - When the `@coasys/ad4m` pin in the root `package.json` moves, re-check this and move this
 *   constant with it — the pin moving and this staying put is exactly the silent case.
 * - Verify by running the query, not by reading the changelog. `packages/backend-system/ad4m/tests`
 *   pins what the *planner* says; only an executor answers what the executor does.
 *
 * The pin itself is currently a test tag rather than a release, which is worth knowing when reading
 * "verified": what was verified was that build.
 *
 * This one was hand-published from `dev` at **54a3fd956** — the merge of coasys/ad4m#927, which
 * completes the eight-PR model-layer series — under npm's `dev` tag rather than `latest`. The SHA
 * matters more here than usual: a hand-published version corresponds to no git tag, so it is the
 * only thing tying this string to a build. And the executor binary is never published at all (WE
 * runs the one at `ad4m/target/release/`, per `seed-runtime.json`), so the Rust half — which is
 * where five of those eight PRs live — is pinned by that SHA and by nothing else. A core built
 * from this commit against an executor built from another is exactly the skew this constant exists
 * to make visible, and npm cannot catch it.
 */
export const VERIFIED_AGAINST_AD4M = '0.13.0-test-model-layer';

export const ad4mCapabilities: AdapterCapabilities = {
  /*
    `exists` is deliberately absent, and its absence is a correction rather than a change of policy.
    The executor has no such operator: `WhereOps` does not declare one and uses `deny_unknown_fields`,
    so `{ field: { exists: true } }` is refused as an operator object and re-read as a nested where
    clause. That is incomplete, so it routes to the post-hydration filter — where a `SubClause`
    reaching a value comparison returns false. Every row is rejected and the query answers nothing,
    always, with no error anywhere.

    Claiming it here made that silent. Dropping it makes the query refuse instead, which is the
    honest answer while the operator does not exist, and nothing in WE regresses: the two live uses
    are `filter()` in a GlobeView expression and a graph style rule, both evaluated client-side and
    neither of them a `$query`. It is the *documented* idiom for "absent counts as the default" that
    this invalidates, which is worth more attention than the code change.
  */
  operators: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'nin', 'contains'],
  /*
    Numbers only. The executor's `WhereOps` holds each bound as an `f64`, so `{ dueDate: { lt:
    '2026-10-01' } }` fails to deserialise as an operator, is reread as a nested clause, and rejects
    every row — the `exists` failure above, again. A number bound is compared against the stored
    value after the executor parses it, which reads RFC 3339 timestamps but not the zone-less
    `YYYY-MM-DD` WE writes, so a date range cannot be pushed down by converting the bound either.
    Refused until the executor compares strings; see ad4m-follow-ups.
  */
  rangeBounds: ['number'],
  booleanCombinators: true, // OR / AND / NOT in `where` (#868)
  relationFilters: true, // `some` / `none` compile to a SPARQL EXISTS group (#923)
  scope: true, // drill-down via `parent`
  // The executor's `Scope::Traverse`: several anchors in one query, `+` paths, inbound term
  // order, and a per-anchor slice applied between selecting ids and hydrating them.
  boundedTraversal: { multiAnchor: true, transitive: true, inbound: true, perAnchorLimit: true, levelWalk: true },
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
 * every relation (WE + synced) via `EntityManifestProperty.predicate`.
 */
function resolveScopeToParent(models: EntityManifestEntry[], scope: Scope): Record<string, unknown> {
  const entry = scope.anchor ? models.find((m) => m.name === scope.anchor) : undefined;
  const prop = entry?.properties.find((p) => p.name === scope.via);
  if (!prop?.predicate) {
    throw new Error(
      `ad4mQueryAdapter: cannot resolve scope { anchor: "${scope.anchor}", via: "${scope.via}" } — ` +
        `no such relation in the current perspective's model manifest`,
    );
  }

  // The plain drill-down stays exactly as it was: one anchor, one step outward, and the `{ id,
  // predicate }` shape every existing query already sends.
  const bounded =
    Array.isArray(scope.anchorId) ||
    scope.transitive ||
    scope.direction === 'in' ||
    scope.limitPerAnchor !== undefined ||
    scope.levels !== undefined;
  if (!bounded) return { id: scope.anchorId, predicate: prop.predicate };

  // Anything more is the executor's traverse form, which names its anchors as `ids`. An empty list
  // stays an empty list rather than being dropped: "the replies to none of these" answers with
  // nothing, where omitting the scope would answer with the whole space.
  return {
    ids: Array.isArray(scope.anchorId) ? scope.anchorId : [scope.anchorId],
    predicate: prop.predicate,
    ...(scope.transitive ? { transitive: true } : {}),
    ...(scope.direction === 'in' ? { direction: 'in' } : {}),
    ...(scope.limitPerAnchor !== undefined ? { limitPerAnchor: scope.limitPerAnchor } : {}),
    ...(scope.levels !== undefined ? { levels: scope.levels } : {}),
  };
}

/**
 * Build the AD4M {@link QueryAdapter}. A factory (not a singleton) because `lower` needs the current
 * perspective's model manifest to resolve a `scope` drill-down — so `getEntities` returns the SHACL model
 * entries (including synced ones, e.g. Flux's) at call time.
 *
 * `plan` is `planQuery` over `ad4mCapabilities` plus the one conditional degradation no capability
 * boolean captures: a projection or relation-path sort silently no-ops without a `limit`. `lower` is
 * the neutral `irToFlatQuery`, plus resolving `scope` → `parent` here (AD4M-specific;
 * `irToFlatQuery` throws on `scope` by design).
 */
export function createAd4mQueryAdapter(getEntities: () => EntityManifestEntry[]): QueryAdapter {
  return {
    capabilities: ad4mCapabilities,

    plan(ir: QueryIR): QueryPlan {
      const base = planQuery(ir, ad4mCapabilities);
      const gaps: CapabilityGap[] = [...base.gaps];
      if (ir.sort?.length) {
        /*
          `sort:under-boolean` used to be raised here and is gone, because the thing it described
          stopped being true. The pagination pushdown is gated on `all_where_pushable`, which is now
          nothing but `compile_where_clause(...).complete` — one compiler answering for its own
          emission rather than a second function guessing at it — and OR and NOT compile. So a sort
          beside an explicit combinator keeps its pushdown, and there is no degradation to report.
        */
        const aggregateAliases = new Set((ir.aggregate ?? []).map((a) => a.as));
        if (!ir.page && ir.sort.some((k) => sortNeedsLimit(k.by, aggregateAliases))) {
          gaps.push({
            feature: 'sort:needs-limit',
            path: 'sort',
            disposition: 'degraded',
            // Still true, and checked rather than assumed: `sparql_pagination` is only built when
            // `limit` or `offset` is present, and the post-hydration fallback sort runs before the
            // projection data is attached — so those two sort kinds have nothing to sort on.
            note: 'AD4M returns correct rows but silently ignores a projection/relation-path sort without a limit',
          });
        }
      }
      return { runnable: base.runnable && !gaps.some((g) => g.disposition === 'unsupported'), gaps };
    },

    lower(ir: QueryIR): QueryOptions {
      // `scope` is AD4M-resolved here (irToFlatQuery throws on it); everything else lowers neutrally.
      // `entity` is selected via getEntity(entity) separately, so the options carry only the query.
      const { scope, ...rest } = ir;
      const { entity: _entity, ...opts } = irToFlatQuery(rest);
      void _entity;
      if (scope) {
        (opts as Record<string, unknown>).parent = resolveScopeToParent(getEntities(), scope);
      }
      return opts as QueryOptions;
    },
  };
}
