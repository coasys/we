# PR B: Include Projections v2 (`$`-prefix IncludeMap keys)

**Branch:** `feat/include-projections-v2` off `origin/feat/sparql-1.2-cleanup`
**Target:** `feat/sparql-1.2-cleanup`
**Depends on:** None (PRs A and B are independent of each other)

---

## Overview

Add `IncludeProjection` — a new variant in `IncludeMap` using `$`-prefixed keys — allowing callers to derive named computed fields from a relation without hydrating every instance. Three projection modes:

| Mode | Syntax | Result type |
|---|---|---|
| Count | `{ $signalCount: { from: 'signals', count: true } }` | `number` |
| Filtered list | `{ $recentMsgs: { from: 'messages', where: { ... }, limit: 5 } }` | `T[]` |
| Single item | `{ $mySignal: { from: 'signals', where: { author: did }, limit: 1 } }` | `T \| null` |

This was originally implemented in `feat/include-projections` as a **JS-side feature** on top of `hydrateRelations` / `buildSPARQLGroupedCountQuery`. That entire pipeline no longer exists in `sparql-1.2-cleanup` — all queries now route through the Rust `perspectiveModelQuery` endpoint. This PR reimplements the feature using a **TS-side post-processing approach** on top of the Rust pipeline.

---

## Motivation (unchanged from original)

WE's schema system needs to express derived counts and filtered subsets in query results without multiple round-trips. The primary use cases are:

- `$unreadCount: { from: 'messages', where: { readBy: { not: myDid } }, count: true }` — badge count per channel
- `$latestMessage: { from: 'messages', order: { timestamp: 'DESC' }, limit: 1 }` — preview text
- `$myReaction: { from: 'reactions', where: { author: myDid }, limit: 1 }` — current user's reaction

Without this, callers must either hydrate all relation instances (expensive) or issue separate queries per instance (N+1 problem).

---

## Why the old approach is gone

`feat/sparql-1.2-cleanup` deleted:
- `hydrateRelations()` from `hydration.ts` (file shrank from 1,061 to 304 lines)
- `buildSPARQLGroupedCountQuery()` / `parseSparqlGroupedCount()` from `query-sparql.ts`
- `groupSPARQLResults()`, `parseSparqlCount()`, `buildSPARQLCountQuery()` — all gone
- `query-sparql-batch.ts`, `hydration-batch.ts` — deleted entirely

The old implementation built custom SPARQL within the client and processed results in JS. That path is closed.

---

## New Approach: TS Post-Processing on Top of Rust Results

### Key insight

`$`-prefixed projection keys are **not relation fields on the model** — they are derived values requested by the caller. The Rust endpoint doesn't know about them and shouldn't need to. The right architecture is:

1. **Strip projection keys** from the include map before sending to Rust
2. **Execute the Rust query** with the clean include map (normal relation hydration proceeds as before)
3. **Execute projection sub-queries in parallel** per-instance after Rust returns results
4. **Attach results** onto each instance under the `$`-prefixed key

For the count mode specifically, this uses `TargetClass.count(perspective, { parent: { id: instance.baseExpression, predicate }, ...projection.where })` — the already-optimised `COUNT(DISTINCT ?source)` path in `executeModelQuery`. For filtered/single-item modes, it uses `TargetClass.findAll(perspective, { parent: { id: instance.baseExpression, predicate }, ...subquery, limit: projection.limit })`.

### Performance profile

- **Grouped count (original approach):** One SPARQL query returning `(parentIRI, count)` pairs. Cost: 1 query regardless of result set size.
- **Post-processing (new approach):** One `count()` call per instance. Cost: N queries where N = number of result instances.

For collection queries returning many instances this is worse than the original. However:

- Most projection use cases target single-instance gets (`get({ include: { $unreadCount: ... } })`) where N = 1
- For list queries, projection keys are typically used only on paginated results (small N, e.g. 20–50 items), and calls are parallel via `Promise.all`
- The grouped count optimisation can be added as a later enhancement (Phase 2) once the API contract is stable

This is an acceptable tradeoff for the initial port. The API surface is identical — no caller needs to change if the grouped path is added later.

---

## Changes

### 1. `core/src/model/types.ts`

Add `IncludeProjection` type and extend `IncludeMap`:

```typescript
export interface IncludeProjection {
  /** The declared relation name on the model to derive the projection from. */
  from: string;
  /**
   * When true, the result is the count of matching instances as a `number`.
   * `count: true` → result type is `number`.
   */
  count?: true;
  /** Filter applied to the related instances before the result is produced. */
  where?: Where;
  /**
   * Maximum number of results.
   * When `limit === 1`, result type is `T | null` (unwrapped single instance).
   */
  limit?: number;
  /** Sort order applied before limit. */
  order?: Order;
}

export interface IncludeMap {
  [relation: string]: boolean | RelationSubQuery | IncludeProjection;
}
```

Helper type guard (used internally):

```typescript
export function isIncludeProjection(val: unknown): val is IncludeProjection {
  return typeof val === 'object' && val !== null && 'from' in val;
}
```

---

### 2. `core/src/model/Ad4mModel.ts`

**`executeModelQuery`** — modify include pre-processing:

Before passing `queryInput.include` to Rust, split the include map:
- Keys without `$` prefix and values that are `boolean` or `RelationSubQuery` → pass to Rust as normal
- Keys with `$` prefix (or any value that `isIncludeProjection`) → collect into a separate `projections` map; do not pass to Rust

After Rust returns instances, execute projections:

```typescript
if (projections.size > 0) {
  await Promise.all(
    instances.map(async (inst) => {
      const instanceId = inst.baseExpression;
      await Promise.all(
        Array.from(projections.entries()).map(async ([key, proj]) => {
          const relMeta = allRelMeta[proj.from];
          if (!relMeta?.target) return;
          const TargetClass = relMeta.target() as typeof Ad4mModel;
          const subQuery = {
            parent: { id: instanceId, predicate: relMeta.predicate },
            ...(proj.where && { where: proj.where }),
            ...(proj.order && { order: proj.order }),
          };
          if (proj.count) {
            (inst as any)[key] = await TargetClass.count(perspective, subQuery);
          } else {
            const limit = proj.limit;
            const results = await TargetClass.findAll(perspective, {
              ...subQuery,
              ...(limit !== undefined && { limit }),
            });
            (inst as any)[key] = limit === 1 ? (results[0] ?? null) : results;
          }
        })
      );
    })
  );
}
```

`resolveParentPredicate` is already available in scope.

---

### 3. `core/src/model/query-sparql.test.ts`

Add tests for the new `IncludeProjection` type helpers (type guard, discriminator logic).

---

### 4. `core/src/model/Ad4mModel.test.ts`

New `describe` block: **`IncludeProjection ($-prefix keys)`**

Tests using mock `perspective.modelQuery` (same mock pattern as existing tests):

- `$`-prefixed key does not appear in the include map sent to Rust
- Normal (non-`$`) keys still included in Rust include map unchanged
- `count: true` projection calls `count()` and attaches result as `number`
- Filtered list projection calls `findAll()` with `where` + limit
- `limit: 1` projection unwraps to single instance (`T | null`), not array
- `limit: 1` returns `null` when no results
- `order` is forwarded to the sub-query
- Multiple projections executed in parallel per instance
- Projections applied to each instance in a multi-instance result set
- Projection with unknown `from` relation is silently skipped

---

## What is NOT in this PR

- **Grouped COUNT optimisation** — a single batch SPARQL `COUNT GROUP BY ?parent` would be more efficient for large result sets. This is a Phase 2 performance enhancement. The API contract is identical; no caller changes needed when it is added.
- **Rust-native projection support** — extending the `perspectiveModelQuery` endpoint to understand `$`-prefix keys natively. Possible future work; not required for correctness.
- No changes to `hydration.ts`, `query-sparql.ts`, or the Rust layer.

---

## Files Changed

| File | Change |
|---|---|
| `core/src/model/types.ts` | Add `IncludeProjection` type, `isIncludeProjection` guard, extend `IncludeMap` |
| `core/src/model/Ad4mModel.ts` | Modify `executeModelQuery` to split and post-process projection keys |
| `core/src/model/Ad4mModel.test.ts` | Add `IncludeProjection` describe block |
| `core/src/model/query-sparql.test.ts` | Add `isIncludeProjection` type guard tests |

No new files. No Rust changes. No deletions.

---

## Validation

```bash
cd core && pnpm test
```

Expected: all existing 153 `Ad4mModel` tests + 36 `query-sparql` tests still pass + new projection tests added.

---

## Open Questions (resolve before/during implementation)

1. **`$`-key naming convention vs `isIncludeProjection` guard** — should detection be purely by `$` prefix, purely by `isIncludeProjection(val)`, or both? The current design uses the type guard (structural check on the value) so that valid projections don't require a naming convention, and the `$` prefix is convention-only for callers. Confirm this is the right approach.

2. **Error behaviour for unknown `from` relation** — silent skip (current plan) vs `console.warn` vs throw. Recommend `console.warn` in development builds at minimum.

3. **Interaction with `properties` projection** — `query.properties` strips fields from returned instances. Should it also gate which `$`-projections run? Probably not (projections are explicitly requested by name), but confirm.
