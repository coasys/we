# PR Plan: Model Query Path Unification

## Summary

Eliminate the duplicated query preparation logic between `executeModelQuery` (one-shot path) and `ModelQueryBuilder.subscribe()` (subscribe path) in `ad4m/core/src/model/Ad4mModel.ts`. Both paths share the same logical pipeline but implement preparation independently — this caused three bugs in the projection hydration work and will cause more. The fix is incremental: first make `executeModelQuery` delegate to `prepareModelQueryParams` for the preparation step (removing the last duplicated logic), then optionally go further by making the static convenience methods (`findAll`, `find`, etc.) thin wrappers over `ModelQueryBuilder`.

---

## Motivation

### The two-path problem

The model query layer has two separate entry points:

```
findAll / find / findOne               executeModelQuery (private)
      ↓                                         ↓
executeModelQuery                     builds queryInput inline
      ↓                                         ↓
Rust modelQuery RPC                   Rust modelQuery RPC
      ↓                                         ↓
hydrateProjections                    hydrateProjections
resolveNonLiteralProps                resolveNonLiteralProps
takeSnapshot                          takeSnapshot


ModelQueryBuilder.query().subscribe()
      ↓
prepareModelQueryParams              ← shared since projection-hydration PR
      ↓
Rust modelSubscribe RPC
      ↓
hydrateProjections                   ← shared since projection-hydration PR
resolveNonLiteralProps
takeSnapshot
```

The "prepare" step — converting a `Query` object into `{ className, queryJson, shapeJson }` — is the core of the duplication. `prepareModelQueryParams` is the canonical implementation (used by the subscribe path), but `executeModelQuery` still builds its own `queryInput` from scratch with ~80 lines of duplicated logic. Any change to how queries are prepared must be applied in both places.

### Evidence from the projection-hydration PR

The projection-hydration PR (previous session) had to fix three independent gaps in the subscribe path that were already handled in `executeModelQuery`:

1. `$`-prefixed keys not split to `projections` in `prepareModelQueryParams`
2. `includeAll` expansion missing from `prepareModelQueryParams`
3. Projection IRIs not hydrated (shared via `hydrateProjections` as part of that fix)

The first two existed _only_ because `prepareModelQueryParams` was a copy that had gotten out of date. If `executeModelQuery` had delegated to `prepareModelQueryParams`, there would have been nothing to get out of sync.

---

## Current State

`prepareModelQueryParams` is fully correct and handles everything:

- `parent` resolution with `resolveParentPredicate`
- `$`-prefixed key splitting to `queryInput.projections` with target-shape enrichment
- Normal include splitting with `enrichShapeForIncludes`
- `where`, `order`, `offset`, `limit`, `count`, `deepQuery`
- Conformance getter compilation and `whereFilter`/`wherePredicates` attachment

`executeModelQuery` duplicates all of the above (~80 lines) and then additionally handles:

- `includeAll` expansion (missing from `prepareModelQueryParams`)
- The actual Rust RPC call (`perspective.modelQuery`)
- `jsonToModelInstance` conversion
- `hydrateProjections`
- `resolveNonLiteralProps`
- `takeSnapshot`

The only post-preparation behaviour `executeModelQuery` owns exclusively is the last four items — everything before the RPC call is duplicated logic.

---

## Target State

### Phase 1 — `executeModelQuery` delegates to `prepareModelQueryParams` (recommended immediate PR)

Move `includeAll` expansion into `prepareModelQueryParams` (it belongs there — preparation is preparation), then replace `executeModelQuery`'s inline queryInput construction with a call to `prepareModelQueryParams`:

```typescript
private static async executeModelQuery<T>(
  perspective: PerspectiveProxy,
  query: Query = {},
  classNameOverride?: string | null,
): Promise<ResultsWithTotalCount<T>> {
  // prepareModelQueryParams now owns includeAll expansion too
  const { className, queryJson, shapeJson } = (this as any).prepareModelQueryParams(query, classNameOverride);

  const result = await perspective.modelQuery(className, queryJson, shapeJson);

  const instances: T[] = result.instances.map((json: any) =>
    jsonToModelInstance(this, perspective, json, query.include, query.properties)
  );

  if (query.include) {
    await (this as any).hydrateProjections(perspective, instances, query.include);
  }
  await (this as any).resolveNonLiteralProps(perspective, instances);

  const snapshotRelations = JSON.parse(queryJson).include;
  for (const inst of instances) {
    (inst as Ad4mModel).takeSnapshot(snapshotRelations);
  }

  return { results: instances, totalCount: result.totalCount };
}
```

After this change, all preparation logic lives in exactly one place. Both paths — one-shot and subscribe — produce identical `queryJson`/`shapeJson` for the same `Query` input.

**`prepareModelQueryParams` needs one addition**: `includeAll` expansion (currently only in `executeModelQuery`). This should move in alongside the other normalisation logic.

### Phase 2 — Static methods as `ModelQueryBuilder` wrappers (optional follow-up)

`findAll`, `find`, `findOne`, `findAllPaginated`, `count`, etc. all call `executeModelQuery` directly. The static methods could each instantiate a `ModelQueryBuilder` internally and call `.get()` / `.first()` / `.count()` etc., eliminating `executeModelQuery` as a separate code path entirely:

```typescript
static async findAll<T>(perspective, query) {
  return (this as any).query(perspective, query).get();
}
```

**Important**: this is purely an _internal routing_ change. The external API — nested JSON query objects (`{ where: { ... }, include: { ... } }`) — stays identical. `ModelQueryBuilder`'s constructor already accepts a full `Query` object, so `findAll(perspective, { where: { type: 'root' }, include: { $totalLikeCount: {...} } })` would still work exactly as before. The fluent chaining API (`.where(...).order(...)`) is just a convenience layer on top, not a replacement.

The benefit is zero divergence — everything routes through the same execution path. The downside is a slightly less direct call stack and marginal overhead for high-frequency one-shot calls that don't need subscription infrastructure. Defer until Phase 1 has been in production for a while.

---

## Changes (Phase 1)

All changes are in `ad4m/core/src/model/Ad4mModel.ts`.

| What                                                                                         | Detail                                                                                                                                    |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Move `includeAll` expansion into `prepareModelQueryParams`                                   | The expansion is a query normalisation step — it belongs with the other preparation, not scattered across both entry points               |
| Remove inline `queryInput` construction from `executeModelQuery`                             | ~80 lines replaced with a single `prepareModelQueryParams` call                                                                           |
| `executeModelQuery` receives `query.include` from the original `Query`, not from `queryJson` | The parsed `queryInput.include` currently used for `takeSnapshot` should be `query.include` (the pre-serialisation value) for consistency |
| No changes to `ModelQueryBuilder`                                                            | It already calls `prepareModelQueryParams`                                                                                                |
| No changes to Rust                                                                           | Identical serialised JSON output                                                                                                          |

**Risk**: Low. `prepareModelQueryParams` is already exercised by every subscribe call. Unit tests cover both paths. The only net behavioural change is that `includeAll` expansion now also applies on the subscribe path (it was missing before — this is a fix, not a regression).

---

## Test Plan

- All existing 427 TS unit tests must pass unchanged
- Add one test: `ModelQueryBuilder.subscribe()` with `includeAll: true` correctly expands to all forward relations (was previously a silent no-op on the subscribe path)
- Verify `executeModelQuery` with `includeAll: true` still returns the same results as before (snapshot test on the `queryJson` passed to the mock)

---

## Relationship to Previous Work

This PR is the follow-on cleanup to `feat/projection-signal-hydration`. That PR shared `hydrateProjections` between the two paths. This PR shares the preparation step, completing the convergence. Phase 2 (full unification through `ModelQueryBuilder`) can be a separate PR if desired.
