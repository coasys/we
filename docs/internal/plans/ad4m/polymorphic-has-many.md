# Plan: Polymorphic @HasMany for Ad4mModel

> Feature request: allow `@HasMany` to hydrate children as their correct `@Model` subclass instead of the declared target class.

> **Status (Aug 2026): not started upstream, and now has a second motivating case.** Nothing in
> `ad4m/core/src/model` mentions `polymorphic`, and no PR — open, merged or closed — implements it.
> Two things have changed since this was written; see **Revisions** at the end before starting work.

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

---

## Revisions (Aug 2026)

Three findings from re-checking the upstream repo before starting. None invalidate the plan; two
change how a step should be done, and one adds a second consumer.

### 1. There is no model registry in AD4M core — and there should not be one

The scope list says "Add model registry lookup (**may already exist** — check `Ad4mModel` class
registry)". It does not: nothing in `core/src/model/*.ts` matches `registerModel` / `modelRegistry` /
`classRegistry`. WE has one (`@we/models/modelRegistry`); AD4M has none.

Rather than introduce a global registry upstream, **take a resolver in the same shape
`fromSHACL` already uses**:

```ts
classResolver?: (localName: string) => typeof Ad4mModel | undefined
```

`Ad4mModel.fromSHACL` (`core/src/model/Ad4mModel.ts:1946-2010`) already accepts exactly this, and for
the same reason — the caller knows its own classes and AD4M should not have to. Following that
precedent keeps the feature free of process-global mutable state, which is what makes a registry
awkward across multiple perspectives and a hot reload. The consumer passes its resolver on the query,
or the decorator holds one:

```ts
@HasMany(() => WeNode, { through: 'we://children', polymorphic: true, classResolver: getBlockModel })
```

### 2. `sh:class` now survives the round trip — but that is the _declared_ target, not the instance's

`feat/fromSHACL-class-resolver` (commit `d47a16bb5`) is **merged to dev**. It fixed
`parse_shacl_to_links` silently dropping `sh:class`, `ad4m://getter` and
`ad4m://conformanceConditions`, which had left every collection property on a `fromSHACL`-reconstructed
class with no target wired up.

Worth reading before starting, and worth _not_ mistaking for this feature. It resolves what a relation
**declares** it points at. Polymorphism is about what each instance **is**, which is a different lookup
and still missing: `getSubjectClassMetadata` goes className → metadata, and there is no reverse
(URI → class) primitive. The batch type resolution in **Proposed Solution** is still the new work, and
option 1 (a SurrealDB batch over the type/flag links) is still the right shape.

### 3. The "Files to modify" table above is stale — hydration moved to Rust

`core/src/model/hydration.ts` is now a **27-line shim** retaining only `normalizeValue()`. Its own
header says why: _"After the Rust model_query pipeline migration, most hydration logic moved to
Rust."_ The real hydration is `rust-executor/src/perspectives/model_query/` (`hydration.rs`,
`relations.rs`, `shape.rs`, `projection.rs`).

What survives TS-side is **class instantiation**, and that is the interesting part.
`jsonToModelInstance` (`core/src/model/Ad4mModel.ts:38`) does:

```ts
const instance = new ModelClass(perspective, json.id || json.baseExpression);
```

and at line ~105 instantiates each nested relation item with the single declared `TargetClass`. **That
line is where polymorphism is decided**, and it is plain TypeScript. If the per-child JSON carried its
concrete type — or if a resolver could be consulted — choosing a different class per item is a small,
local change that never enters the Rust pipeline.

### 4. Do not branch into `model_query` right now — that area is contested

| PR   | Branch                                           | Base     | State | Last touched |
| ---- | ------------------------------------------------ | -------- | ----- | ------------ |
| #842 | `refactor/typed-rdf-literals-and-fn-cleanup`     | dev      | open  | 2026-07-30   |
| #846 | `refactor/sparql-pushdown-last-write-wins`       | **#842** | draft | 2026-07-27   |
| #853 | `feat/model-query-construct-hydration`           | **#846** | draft | 2026-06-11   |
| #874 | `…-nico-refactor` ("old state with refactoring") | dev      | open  | 2026-08-03   |

A three-deep unmerged stack over the model_query hydration path, plus a competing refactor of the same
base (#874) that is more recently active than the stack above it. Anything landing inside
`model_query/` now rebases repeatedly or blocks on that resolving.

### 5. Recommended split: ship the missing primitive first, off `dev`

The one thing genuinely absent is a **URI → concrete class name** lookup. Its mirror already exists:
`perspective.isSubjectInstance(uri, className)` answers _"is this URI an instance of class X"_. What
nothing answers is _"what class is this URI"_, in one call, for many URIs.

That absence is already costing WE, independently of this feature. `resolveBlockModel`
(`packages/block-system/shared/src/serialization.ts:447`) is:

```ts
for (const ModelClass of getRegisteredBlockModels()) {
  if (await perspective.isSubjectInstance(uri, className)) return ModelClass;
}
```

— up to 16 sequential round trips **per block**, then a `findOne` per block, to load one post's tree.

So split the work:

**PR 1 — `subjectClassOf(uris: string[]): Promise<Map<string, string>>` (or similar), branched off `dev`.**
Batched, executor-side, near the existing subject-class code rather than inside `model_query/`
hydration. Avoids the contested stack entirely. Independently valuable: it collapses WE's N×M loop to
one call with no polymorphic feature at all, and it is the prerequisite the full feature needs anyway.

**PR 2 — `polymorphic: true`, once PR 1 has landed and the model_query stack has resolved.**
With the primitive in place this is mostly `decorators.ts` plus the class choice at
`jsonToModelInstance`, in the shape described under **Proposed Solution** — and the "batch type
resolution" step, previously the hard part, is already done.

The sequencing also de-risks: if the stack never lands, WE still gets a real improvement from PR 1.

### 6. Second consumer: call transcripts

The plan cites blocks as the motivating case. Call transcripts are now a second, and they are the one
that made the gap _user-visible_ rather than merely inconvenient.

A call's record is a `CollectionBlock` with `kind: 'call'` holding its utterances as `children`. Posts
never hit this because they render from the `editorState` blob rather than traversing the relation —
transcripts cannot, because a shared serialized document is last-write-wins and several agents write
to one call concurrently. So transcripts are the first thing in WE that genuinely reads `children` as
a query.

WE's workaround is now a `scope` drill-down (one extra query per call) rather than manual type
resolution — see **What this unblocks in WE** below.

---

## What this unblocks in WE

WE is **not blocked** on this. `CallsList.ts` drills down with
`scope: { anchor: 'CollectionBlock', via: 'children', anchorId: '$call.id' }`, which is native on AD4M
and `compute-up` on any backend that lacks it. That works today and is correct.

What the feature would change, once it lands:

| Today                                                                                              | With `polymorphic: true`                                                           |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| One drill-down query per parent                                                                    | Folded into the parent query's `include`                                           |
| Children arrive as their concrete class only because the drill-down names one entity (`TextBlock`) | Genuinely mixed children (text + image + task in one collection) hydrate correctly |
| `loadBlocks()` resolves types by hand through the block registry                                   | The ORM does it                                                                    |

So the migration afterwards is **an optimisation, not a correction**: swap a `scope` for an `include`
where the relation is heterogeneous, and retire the manual resolution in `loadBlocks()`. Nothing about
the data model, the predicates or the module contract changes — which is the point of doing it this way
round.
