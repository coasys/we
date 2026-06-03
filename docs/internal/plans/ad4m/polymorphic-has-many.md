# Plan: Polymorphic @HasMany for Ad4mModel

> Feature request: allow `@HasMany` to hydrate children as their correct `@Model` subclass instead of the declared target class.

---

## Problem

When `@HasMany(() => BaseClass, { through: 'predicate' })` is used with an inheritance hierarchy, hydration always instantiates children as the declared target class. Concrete subclass types are lost:

```typescript
@Model({ name: 'CollectionBlock' })
class CollectionBlock extends WeNode {
  @HasMany(() => WeNode, { through: 'we://children' })
  children: WeNode[] = [];
}

const parent = await CollectionBlock.findOne(perspective, {
  include: { children: true },
});

parent.children[0] instanceof TextBlock; // ❌ false — always WeNode
parent.children[0] instanceof ImageBlock; // ❌ false — always WeNode
```

This forces consumers to either:

1. Declare separate `@HasMany` per concrete type (loses ordering, doesn't scale)
2. Use string-only `@HasMany({ through })` and manually resolve types (current WE approach)

---

## Proposed Solution

Add a `polymorphic: true` option to `@HasMany`:

```typescript
@HasMany(() => WeNode, { through: 'we://children', polymorphic: true })
children: WeNode[] = [];
```

When `polymorphic: true`:

1. Hydration queries child links as normal (via predicate)
2. For each child URI, resolves the concrete `@Model` name from its SHACL type flag (`subject_class`)
3. Looks up the concrete class from Ad4m's model registry
4. Hydrates each child with its correct class instead of the declared target

### Hydration change (localized to `hydrateRelations`)

```typescript
// Current path (non-polymorphic):
const TargetClass = meta.target();
const results = await TargetClass.findAll(perspective, fetchQuery);

// Polymorphic path:
if (meta.polymorphic) {
  // 1. Get child URIs from links (already collected)
  // 2. Batch-resolve each child's @Model type name
  const typeMap = await resolveModelTypes(perspective, childUris);
  // 3. Group URIs by type name
  const grouped = groupBy(childUris, (uri) => typeMap.get(uri));
  // 4. Hydrate each group with its concrete class from the model registry
  for (const [typeName, uris] of grouped) {
    const ConcreteClass = modelRegistry.get(typeName) ?? TargetClass;
    const results = await ConcreteClass.findAll(perspective, { id: { in: uris } });
    for (const r of results) hydrated.set(r.id, r);
  }
  // 5. Reassemble in original link order
}
```

### Batch type resolution

The key new operation is resolving `@Model` type names for a set of URIs. Options:

1. **SurrealDB batch query** — `SELECT out.uri AS type FROM link WHERE in.uri IN [...childUris] AND predicate = 'ad4m://type'` (or equivalent SHACL predicate)
2. **Prolog batch** — `findall(Type, (member(URI, [...]), subject_class(Type, URI)), Types)` — may not scale well
3. **Per-URI `subject_class` check** — simple but N+1; acceptable if batched at the perspective level

Option 1 (SurrealDB) is preferred for performance.

---

## Scope

### In scope

- [ ] Add `polymorphic?: boolean` to `RelationOptions` / `RelationMetadataEntry`
- [ ] Store the flag in the relation registry (`decorators.ts`)
- [ ] Implement type resolution in `hydrateRelations()` (`hydration.ts`)
- [ ] Add model registry lookup (may already exist — check `Ad4mModel` class registry)
- [ ] Tests: polymorphic hydration returns correct subclass instances
- [ ] Tests: non-polymorphic behavior unchanged (backwards compatible)

### Not in scope

- CRDT ordering (separate feature)
- `@HasOne` polymorphic support (can follow same pattern later)
- Automatic model registry population (consumers call `registerModel()` or models self-register via `@Model`)

---

## Context

- **WE workaround:** `@HasMany({ through: 'we://children' })` as `string[]`, manual type resolution via block registry in `loadBlocks()`. See [block-persistence-rendering](../prs/block-persistence-rendering.md).
- **Flux pattern:** Separate `@HasMany` per type (works for genuinely separate concerns like Channel → Messages/Tasks/Posts, doesn't work for heterogeneous ordered collections).
- **Prior art:** Rails polymorphic associations, Hibernate `@Any`, Django `GenericForeignKey`.

---

## Files to modify

| File                           | Change                                                             |
| ------------------------------ | ------------------------------------------------------------------ |
| `core/src/model/decorators.ts` | Add `polymorphic` to `RelationMetadataEntry` and `RelationOptions` |
| `core/src/model/hydration.ts`  | Polymorphic resolution branch in `hydrateRelations()`              |
| `core/src/model/Ad4mModel.ts`  | Ensure model registry is accessible for type→class lookup          |
