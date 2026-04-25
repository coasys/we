# PR Plan: Ad4mModel `include` Projections

## Summary

Extend the `include` option on `findAll` / `findOne` / `$query` to support user-named **projections** — derived fields computed from a relation (count, filtered subset, single-item lookup) that appear alongside the model instance under a chosen key.

---

## What already exists

`include` supports two forms today — a boolean shorthand and a `RelationSubQuery` descriptor:

```ts
// RelationSubQuery = Omit<Query, 'parent' | 'count'>
// = { properties?, include?, where?, order?, offset?, limit? }

const posts = await CollectionBlock.findAll(perspective, {
  include: {
    signals: true, // shorthand: load full relation → Signal[]
    comments: {
      where: { status: 'visible' }, // filtered relation → Comment[]
      order: { createdAt: 'DESC' },
      limit: 5,
      include: { author: true },
    }, // nested include works too
  },
});
```

Both forms always attach results under the **relation's own name** as a `T[]` array. The relation key must match a declared `@HasMany`/`@HasOne` field on the model — unrecognised keys are silently warned and skipped.

Notably, `where`, `order`, `limit`, and `offset` on sub-relations **already work** in the SPARQL path.

## What is missing

Three specific capabilities are absent:

**1. User-named alias keys** — There is no way to attach a relation's results under a different name. You can only use the relation's own declared field name. This blocks patterns like loading `mySignal` (a filtered subset of `signals`) and `likeCount` (another derived view of `signals`) as separate, named fields alongside the raw `signals` relation.

**2. Per-relation count returning a `number`** — `count: boolean` is explicitly stripped from `RelationSubQuery` via `Omit`. There is no mechanism anywhere to get a `number` back for an included relation. The global `count()` method counts top-level instances only.

**3. `take: 1` → `T | null` cardinality** — `limit: 1` returns `T[]` with at most one element. There is no way to express "give me a single instance or null" — the schema layer would have to deal with `T[]` and manually index into it, which is awkward in templates.

These three gaps make the common per-node signal queries impossible to express cleanly in schema:

- **How many** signals does this node have? → needs alias + count
- **Did the current user** already signal it? → needs alias + `where: { author: myDid }` + `limit: 1`
- **Only the "like" signals**? → needs alias + `where` (this one is close — works without alias if you only have one signal type, but breaks with multiple projections off the same relation)

This matters most for `$each`-driven schema nodes where each post card needs `$post.signalCount`, `$post.mySignal` etc. as first-class fields available in templates.

---

## Proposed API

### `$`-prefixed keys = projections

Top-level `include` keys that start with `$` are projections — user-named derived fields computed from an underlying relation. Keys without `$` remain the existing "load full relation" short-hand.

```ts
const posts = await CollectionBlock.findAll(perspective, {
  include: {
    // existing: load full relation (boolean or descriptor with where/include)
    signals: true,

    // projections: user-named, always require `from`
    $signalCount: { from: 'signals', count: true },
    $mySignal: { from: 'signals', where: { author: { $store: 'adamStore.me.did' } }, limit: 1 },
    $likeSignals: { from: 'signals', where: { signalTypeId: 'like' } },
  },
});

posts[0].signals; // Signal[]      — full relation
posts[0].$signalCount; // number
posts[0].$mySignal; // Signal | null  (limit: 1 in projection → single object, not array)
posts[0].$likeSignals; // Signal[]
```

### Projection descriptor

```ts
interface IncludeProjection {
  from: string; // relation name declared on the model (must exist)
  count?: true; // if set → result is a number, all other options ignored
  where?: Record<string, unknown>; // filter applied to the loaded relation items
  limit?: number; // limit results; limit: 1 → returns T | null (not T[])
}
```

Note: `limit` is the same field name used in `RelationSubQuery` — meaning projection descriptors are consistent with the existing sub-query syntax. The only difference is that `limit: 1` in a projection returns `T | null` (unwrapped) instead of `T[]` with one element.

### `$store` token resolution in `where`

`where` values may reference the store context using the existing `$store` token pattern. These are resolved by the query executor before the filter is applied, allowing dynamic, user-scoped filters:

```ts
where: {
  author: {
    $store: 'adamStore.me.did';
  }
}
// resolved to → { author: '<current-agent-did>' }
```

This mirrors how `$store` works everywhere else in the DSL and avoids leaking store references into the model layer.

Note: `author` (and `timestamp`) are **special fields** on every `Ad4mModel` instance — automatically injected from link graph metadata at hydration time, never declared as model properties. Currently they are treated as JS-only post-hydration filters (skipped by `buildSPARQLWhereFilters` in `query-sparql.ts`), meaning the executor loads and hydrates every instance before the filter is applied. **This PR extends `buildSPARQLWhereFilters` to push `author` and `timestamp` conditions into SPARQL `FILTER()` expressions**, since `?author` and `?timestamp` are already bound variables in every query's SELECT. This is required for projection `where` clauses like `{ author: myDid }` to be efficient — without it the executor would load and hydrate all signals for every post just to discard all but one.

### Complete example in schema (`SpacePage.ts`)

```ts
{
  type: '$each',
  props: {
    items: {
      $query: {
        model: 'CollectionBlock',
        where:  { type: 'root' },
        subscribe: true,
        include: {
          $signalCount: { from: 'signals', count: true },
          $mySignal:    { from: 'signals', where: { author: { $store: 'adamStore.me.did' } }, limit: 1 },
        },
      },
    },
    as: 'post',
  },
  children: [
    {
      type: 'SignalControl',
      props: {
        signalType:  '$post.likeSignalType',   // from a separate SignalType query
        myValue:     '$post.$mySignal.value',
        aggregate:   '$post.$signalCount',
        onSignal:    { $action: 'signalStore.upsert', args: ['$post.id', 'like', '$arg'] },
      },
    },
  ],
}
```

---

## Semantics

| Descriptor                  | Result type | Notes                                                 |
| --------------------------- | ----------- | ----------------------------------------------------- |
| `{ from, count: true }`     | `number`    | All other fields ignored when `count` is set          |
| `{ from }`                  | `T[]`       | Equivalent to `include: { from: true }` but named     |
| `{ from, where }`           | `T[]`       | Filtered subset                                       |
| `{ from, limit: 1 }`        | `T \| null` | Single-item lookup — unwrapped, not an array          |
| `{ from, limit: N }`        | `T[]`       | First N items                                         |
| `{ from, where, limit: 1 }` | `T \| null` | Filtered single-item — the common "my signal" pattern |

---

## TypeScript Typing

Projection result types can be inferred from the descriptor shape using conditional types:

```ts
type ProjectionResult<D extends IncludeProjection, T> = D extends { count: true }
  ? number
  : D extends { limit: 1 }
    ? T | null
    : T[];
```

The model instance type extended with projections:

```ts
type WithProjections<M, I extends IncludeMap> = M & {
  [K in keyof I as K extends `$${string}` ? K : never]: ProjectionResult<
    Extract<I[K], IncludeProjection>,
    RelationTarget<M, I[K]['from']>
  >;
};
```

Exact generic inference of `limit: 1` vs `limit: N` requires a `const` assertion at the call site or a branded type — this can be deferred to a follow-up; the runtime semantics should be locked in first.

---

## Implementation Notes

### Where to implement

- **`ad4m/core/src/model/types.ts`** — add `IncludeProjection` type; update `IncludeMap` to allow `$`-prefixed projection keys. Note: `RelationSubQuery` is defined as `Omit<Query, 'parent' | 'count'>` — it silently inherits the new `deepQuery?: boolean` flag added in PR #800, so projections will automatically support `deepQuery` if desired.
- **`ad4m/core/src/model/hydration.ts`** (`hydrateRelations`) — detect and process `$`-prefixed keys. PR #800 improved the reverse-relation path (now batched via a single SPARQL query per relation), but the forward-relation (`hasMany`) path that projections would use was already batched and is unchanged.
- **`ad4m/core/src/model/query-sparql.ts`** — three additions:
  1. `buildSPARQLGroupedCountQuery` — new function written with the full named graph pattern (`GRAPH ?linkGraph { ... }` + author/timestamp triples); adds `?parent <predicate> ?source`, `FILTER(?parent IN (...))`, and `GROUP BY ?parent`. Note: the existing `buildSPARQLCountQuery` is intentionally minimal (no named graph; fast for pagination totalCount) and is left unchanged — it is not used in the projection path.
  2. `parseSparqlGroupedCount` — parallel to existing `parseSparqlCount`; returns `Map<parentId, number>`
  3. Extend `buildSPARQLWhereFilters` / `hasJsOnlyWhereFilters` to push `author` and `timestamp` into SPARQL `FILTER(?author = ...)` / `FILTER(?timestamp ...)` expressions — `?author` and `?timestamp` are bound by the named graph block present in `buildSPARQLQuery` and `buildSPARQLGroupedCountQuery`; the existing minimal `buildSPARQLCountQuery` already skips `author`/`timestamp` in JS, so no regression there
- **WE `$query` service** — `$store` token resolution in `where` clauses (already exists for top-level `where`, needs extending to projection `where`)

This is an **upstream AD4M change** — `types.ts` and `hydration.ts` live in the AD4M repository. The current working branch is `feat/architectural-optimisation` (PR #800).

### Query strategy

`hydrateRelations` in `hydration.ts` is the right place to add projection handling. The existing code already:

1. Processes each key in `include`
2. Looks the key up in relation metadata
3. Calls `TargetClass.findAll()` with sub-query filters
4. Attaches results to the instance

Two distinct code paths depending on whether `count: true` is set:

#### Path A — `count: true` (grouped SPARQL COUNT)

1. Detect `$`-prefix + `count: true` → dedicated COUNT path
2. Look up `relMeta = getRelationsMetadata(modelClass)[proj.from]`; warn + skip if missing
3. Collect all parent instance IDs into `allParentIds`
4. Build and execute a single grouped COUNT query directly via `perspective.querySparql()`:

```sparql
SELECT ?parent (COUNT(DISTINCT ?source) AS ?count) WHERE {
  ?parent <predicate> ?source .
  FILTER(?parent IN (<id1>, <id2>, ...))
  GRAPH ?linkGraph { ?source ?p ?t }
  ?linkGraph <ad4m://ontology/author> ?author .
  ?linkGraph <ad4m://ontology/timestamp> ?timestamp .
  /* SPARQL filters translated from projection where (incl. author/timestamp) */
}
GROUP BY ?parent
```

5. Map results: `Map<parentId, number>` from `{ parent.value, count.value }`
6. Assign: `instance[projectionKey] = countMap.get(instance.id) ?? 0`

This returns one row per parent with zero instance hydration, regardless of signal volume.

#### Path B — filtered arrays / `limit: 1` (findAll + Map distribution)

1. Detect `$`-prefix without `count: true` → `findAll` path
2. Look up `relMeta`; warn + skip if missing
3. **Collect child IDs** — for each instance, read `instance[from]` (raw link targets: URIs or objects with `.id`), collect into `Set<string>` across all instances. For reverse relations (`belongsToOne`/`belongsToMany`), use the existing batched SPARQL reverse-lookup pattern.
4. **One `findAll` per distinct projection** — `TargetClass.findAll(perspective, { where: { id: [...allChildIds], ...projWhere } })`. The `id: [...]` IN-clause becomes a SPARQL `FILTER(?source IN (...))`. The `projWhere` fields (including `author`/`timestamp` after the SPARQL fix) are also executor-filtered. One round-trip regardless of parent count.
5. Build `Map<childId, TargetInstance>` from results.
6. **Per-parent distribution in JS** (O(k) map lookups, no additional queries):
   - `limit: 1` → first of `instance[from]`'s IDs that appears in the map, `?? null`
   - `limit: N` → first N matching IDs as array
   - no limit → all matching IDs as array
7. Attach result to `instance[projectionKey]`

The goal is **one executor call per distinct projection** across all parent instances. All filtering is SPARQL-side; JS only does map lookups and slicing.

### `$store` resolution

The query service layer (in WE, not AD4M) must resolve `$store` tokens in `where` before handing the resolved query to `findAll`. AD4M itself receives only plain values.

---

## Scope

- [ ] Add `IncludeProjection` type to `types.ts`; update `IncludeMap` to allow `$${string}` keys with `IncludeProjection` values
- [ ] In `query-sparql.ts`: add `buildSPARQLGroupedCountQuery` (new function with full named graph pattern + `GROUP BY ?parent`); add `parseSparqlGroupedCount` returning `Map<parentId, number>`; extend `buildSPARQLWhereFilters` / `hasJsOnlyWhereFilters` to push `author` and `timestamp` into SPARQL `FILTER()` expressions (the existing minimal `buildSPARQLCountQuery` is left unchanged — it is not used in the projection path)
- [ ] In `hydrateRelations` (`hydration.ts`): detect `$`-prefixed keys and split into two paths:
  - **`count: true`**: build and run a grouped `SELECT ?parent (COUNT(DISTINCT ?source) AS ?count) ... GROUP BY ?parent` SPARQL query directly via `perspective.querySparql()`; translate `projection.where` into SPARQL filters using `buildSPARQLWhereFilters`; assign count per parent from result map
  - **filtered arrays / `limit`**: collect child IDs from all parents; one `TargetClass.findAll()` with `{ where: { id: [...], ...projWhere } }`; distribute via `Map<childId, instance>` per parent; apply `limit: 1` unwrap (`T | null`) or `limit: N` slice in JS
- [ ] `limit: 1` in a projection → `T | null` unwrapping (reuses existing `limit` field name; projection code path differs from normal sub-query `limit` which returns `T[]`)
- [ ] Ensure subscription (`subscribe: true`) re-evaluates projections on link changes (projection values are recomputed as part of re-hydration on each subscription tick)
- [ ] Audit and extend WE's `$query` `$store` token resolution to cover `where` clauses inside `include` sub-queries and projections (currently only confirmed for top-level `where`)
- [ ] TypeScript return type inference for projection keys (`WithProjections<T, I>` generic on `findAll`)
- [ ] Unit tests: `count: true` (grouped SPARQL COUNT, zero instance hydration), filtered array with `author` SPARQL filter, `limit: 1` null/non-null unwrap, `limit: N` slicing, batching across multiple parent instances for both paths

---

## Dependencies

- `Signal` and `WeNode.signals` relation — already implemented (merged in `feat/flexible-signal-system`)
- `SignalControl` component — already implemented
- `signalStore.upsert` action — **this is the actual MVP blocker** (separate PR); `SignalControl` needs somewhere to dispatch signal changes to
- Projections themselves have no external dependencies — purely additive to AD4M core

---

## Without projections

The naive workaround is `include: { signals: true }` and a `SignalControl` that filters the full array internally:

```ts
// schema
include: {
  signals: true;
} // → $post.signals: Signal[]

// SignalControl internally:
// count   = signals.filter(s => s.signalTypeId === id).length
// myValue = signals.find(s => s.authorDid === myDid && s.signalTypeId === id)?.value
```

This works for **a single signal type per post card**, but breaks down immediately for the realistic case of multiple signal types displayed simultaneously (like + star rating + flag). The only options are:

1. `include: { signals: true }` — every `SignalControl` re-filters the same full array independently. Functionally OK but wastes work, and `$post.signals` is an ambiguous name when passed to multiple different controls.
2. `include: { signals: { where: { signalTypeId: 'like' } } }` — now only likes are loaded, stars and flags are gone. You can't `include` `signals` twice under different filters.

Neither option scales to even two signal types on one template. Signal types are **community-defined at runtime** — you can't declare a new `@HasMany` per type — so this is a structural limitation, not just a DX issue.

Projections solve it cleanly: one batch load of `signals`, split into named per-type slices, each passed directly to the right `SignalControl`:

```ts
include: {
  $likeSignals:  { from: 'signals', where: { signalTypeId: 'like' } },
  $starSignals:  { from: 'signals', where: { signalTypeId: 'star' } },
  $flagSignals:  { from: 'signals', where: { signalTypeId: 'flag' } },
}
// → $post.$likeSignals: Signal[], $post.$starSignals: Signal[], $post.$flagSignals: Signal[]
```

---

## Priority

**High** — projections are the correct solution for multi-type signal rendering, not just a DX nicety. Without them, displaying more than one signal type per node in a schema-authored template is not expressible. Since signal types are runtime-defined by communities, the inability to load multiple filtered views of the same relation is a fundamental blocker for the signal feature's intended flexibility..
