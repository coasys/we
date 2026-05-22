# PR Plan: Inline Relation Targets in `create()` / `save()`

## Background

`Ad4mModel.create()` currently ignores `@HasOne` and `@BelongsToOne` fields passed
in the `data` argument. The `innerUpdate()` method — which handles writing all field
values to the graph — explicitly skips scalar relation fields:

```typescript
const relationMeta = this.getRelationOptions(key);
if (relationMeta) {
  continue; // ← HasOne/BelongsToOne string values are silently dropped
}
```

This means creating a model with a relation reference always requires two separate
awaited calls:

```typescript
// Current — two steps, window between them where instance has no signalType
const sig = await Signal.create(p, { value }, { parent: ... });
await sig.setSignalType(signalTypeId);
```

If anything throws between the two calls the instance is left in a partially
initialised state in the graph.

---

## Proposed Change

### `core/src/model/Ad4mModel.ts` — `innerUpdate()`

In the scalar-value branch of `innerUpdate()`, when a field has relation metadata
and the value is a non-empty string or a `{ id: string }` object, call
`addRelationValue` (for HasMany) or `setRelationValues` (for HasOne/BelongsToOne)
instead of skipping:

```typescript
const relationMeta = this.getRelationOptions(key);
if (relationMeta) {
  // NEW: write scalar relation targets (HasOne / BelongsToOne) inline
  if (typeof value === 'string' && value !== '') {
    const id = value;
    await this.setRelationValues(key, [id], batchId);
  } else if (value && typeof value === 'object' && 'id' in value) {
    await this.setRelationValues(key, [value.id], batchId);
  }
  continue;
}
```

`setRelationValues` for a maxCount:1 relation already emits a single triple and
clears any previous target, so reusing it here is correct and idempotent.

### Result

```typescript
// After — one atomic step
await Signal.create(p, { value, signalType: signalTypeId }, { parent: ... });
```

The `signalType` triple is written inside the same batch as the `value` triple and
the parent link, so the instance is always fully formed in the graph or not present
at all.

---

## Scope

- Only scalar relation fields (HasOne / BelongsToOne, `is_scalar_relation: true`)
  are affected by this change.
- `@HasMany` / `@BelongsToMany` fields passed as arrays already work today via
  the `Array.isArray(value)` branch — no change there.
- Passing an Ad4mModel instance directly (instead of its `.id` string) is
  **not** in scope; callers should pass `.id` explicitly.
- `update()` benefits automatically since it also calls `innerUpdate()`.

---

## Affected Files

| File                               | Change                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `core/src/model/Ad4mModel.ts`      | `innerUpdate()`: write HasOne/BelongsToOne string values as relation triples |
| `core/src/model/Ad4mModel.test.ts` | New tests for inline HasOne in `create()` and `update()`                     |

---

## Testing

- Unit test: `Model.create(p, { hasOneField: targetId })` emits the correct relation
  triple and `instance.hasOneField` equals `targetId` after creation.
- Unit test: `Model.create(p, { hasOneField: { id: targetId } })` works identically.
- Unit test: passing a `@HasMany` field as an array still works (regression).
- Unit test: `Model.update(p, id, { hasOneField: newTargetId })` replaces the
  existing relation triple atomically.
- Integration test: `Signal.create(p, { value: 1, signalType: signalTypeId }, { parent: ... })`
  produces a single, fully linked Signal instance with no intermediate partial state.
