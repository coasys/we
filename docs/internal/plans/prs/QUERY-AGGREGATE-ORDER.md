# PR Plan: Native Query-Level Sorting by Related Model Aggregates

## Background

`ModelQueryBuilder.order()` currently only works on direct scalar properties of the
queried model (or system fields like `createdAt`). Related model aggregates (e.g.
"sort posts by total like count") are not supported because the query pipeline resolves
`include` relations **after** sorting and pagination have already been applied.

This PR would fix that by moving aggregate projections before the ORDER BY + pagination
step in the Rust executor.

---

## Problem: Current Pipeline Order

```
1. Load model shape (SHACL)
2. Build conformance SPARQL → find matching instance IDs
3. Hydrate instances (parse literal: URIs → typed JSON)
4. Apply JS-only filters (comparison operators on literal props)
5. Calculate total COUNT (for pagination metadata)
6. ← ORDER BY + LIMIT/OFFSET applied here
7. Evaluate property getters (post-pagination, batched)
8. Resolve included relations (batch-fetch + attach arrays)   ← too late for sort
9. Attach $-prefixed projections (count, list aggregates)     ← too late for sort
```

Sorting on `{ $likeCount: 'DESC' }` is impossible because `$likeCount` doesn't exist
at step 6.

---

## Proposed Changes

### 1. Add `aggregate` option to IncludeProjection (JS types, `core/src/model/types.ts`)

Extend the existing `$`-prefixed include projection syntax to support aggregate modes
beyond `count`:

```typescript
// Current
{ $likeCount: { from: 'signals', count: true } }

// Proposed additions
{ $likeCount: { from: 'signals', count: true } }                   // existing
{ $likeScore: { from: 'signals', aggregate: 'sum', field: 'value' } }  // NEW
{ $likeScore: { from: 'signals', aggregate: 'mean', field: 'value' } } // NEW
```

Types to add in `ModelQueryParams` / `IncludeProjection`:

```typescript
type AggregateMode = 'count' | 'sum' | 'mean';

interface IncludeProjection {
  from: string;
  where?: Record<string, unknown>;
  count?: boolean;
  aggregate?: AggregateMode;  // NEW — if set, field is required
  field?: string;             // NEW — property name to aggregate over
  order?: Record<string, 'ASC' | 'DESC'>;
  limit?: number;
}
```

### 2. Move aggregate projection resolution before ORDER BY (Rust, `model_query.rs`)

In `execute_model_query()`, reorder the pipeline:

```
...
5. Calculate total COUNT
6. ← Run $ projection aggregations (grouped SPARQL queries) — NEW POSITION
7. Attach projection results to instances as virtual fields
8. ORDER BY (can now reference projection fields) + LIMIT/OFFSET
9. Evaluate property getters
10. Resolve included relations
11. (Remove projection step from here)
```

**Implementation notes for step 6:**

The `count: true` path already runs a grouped SPARQL query:
```sparql
SELECT ?parent (COUNT(?child) AS ?n)
WHERE { ?parent <predicate> ?child . <where filters> }
GROUP BY ?parent
```

For `sum` and `mean`:
```sparql
SELECT ?parent (SUM(?val) AS ?total)
WHERE {
  ?parent <predicate> ?child .
  ?child <fieldPredicate> ?rawVal .
  BIND(xsd:decimal(?rawVal) AS ?val)
}
GROUP BY ?parent

SELECT ?parent (AVG(?val) AS ?avg)
WHERE { ... }
GROUP BY ?parent
```

The `field` property maps to the model's `@Property({ through: 'we://...' })` predicate.
This predicate lookup is already done in the include resolution code — reuse the same
`resolve_predicate_for_field()` helper.

### 3. Allow `order` to reference projection field names

In the ORDER BY builder, accept `$`-prefixed virtual field names alongside real model
properties:

```typescript
order: { $likeScore: 'DESC' }  // sort by the projection
order: { createdAt: 'ASC' }    // existing behaviour unchanged
```

In Rust: after attaching projection results to instances (step 7), `sort_instances()`
already does type-aware comparison via `compare_values()` — it just needs to check
the virtual fields map in addition to the regular property map.

---

## Usage Example (after this PR)

```typescript
// Sort posts by net vote score (sum of Signal.value for 'vote' type)
const posts = await CollectionBlock.findAll(p, {
  where: { type: 'root' },
  include: {
    $voteScore: {
      from: 'signals',
      aggregate: 'sum',
      field: 'value',
      where: { signalTypeId: voteTypeId },
    },
  },
  order: { $voteScore: 'DESC' },
});
```

---

## Affected Files

| File | Change |
|------|--------|
| `core/src/model/types.ts` | Add `aggregate`, `field` to `IncludeProjection`; add `AggregateMode` type |
| `core/src/model/ModelQueryBuilder.ts` | Accept `$`-prefixed virtual fields in `.order()` validation |
| `rust-executor/src/perspectives/model_query.rs` | Move projection step before ORDER BY; add `sum`/`mean` SPARQL patterns; extend `sort_instances()` to read virtual fields |

---

## Non-Goals

- Median aggregation (requires different SPARQL strategy or post-sort in Rust)
- Nested projection sorting (sorting by an aggregate of an included relation's relations)
- Cross-model joins not represented by `@HasMany` / `@HasOne` relations

---

## Testing

- Unit test: `sum` and `mean` projection SPARQL output matches expected query
- Integration test: `findAll` with `order: { $score: 'DESC' }` returns instances in
  correct order
- Regression test: existing `count: true` projection and `order` on scalar fields
  continue to work correctly
