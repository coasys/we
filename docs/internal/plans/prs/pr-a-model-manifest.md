# PR A: `Ad4mModel.fromSHACL()` (Dynamic Class Loading from SHACL)

**Branch:** `feat/model-manifest` off `origin/feat/sparql-1.2-cleanup`
**Target:** `feat/sparql-1.2-cleanup`

---

## Overview

A single focused addition to `ad4m/core`: `Ad4mModel.fromSHACL()` — a static method that creates a live, fully-queryable `Ad4mModel` subclass from a raw `SHACLShape`, with backward-compat handling for old Flux shapes that predate `sh:hasValue` persistence.

This is a **core primitive** that requires access to ad4m's internal property/relation registry (`setPropertyRegistryEntry` / `setRelationRegistryEntry`). No consumer outside of `core` can replicate it without those internals.

The companion `getModelManifest()` helper (which maps SHACL shapes to a WE-specific AI prompt structure) lives in WE, not here — that transformation is WE's opinion about what AI systems need and does not belong in AD4M core. It calls `perspective.getAllShacl()` and processes the results itself.

---

## Motivation

WE needs to hydrate a fully-queryable `Ad4mModel` subclass from a shape returned by `getAllShacl()`, without needing the original TypeScript class definition. This is required to:

- Query models in external/foreign perspectives (e.g. Flux channels from a WE agent)
- Correctly discriminate types in old Flux perspectives where `sh:hasValue` was not persisted on the property shape directly (backward-compat via `constructor_actions` fallback)
- Enable `fromSHACL` as a general-purpose building block for any AD4M consumer, not just WE

---

## Changes

### 1. `core/src/model/Ad4mModel.ts`

**New static method** on `Ad4mModel`:

```typescript
static fromSHACL(shape: SHACLShape, name: string): typeof Ad4mModel
```

Creates a dynamic subclass with the given class name, walks the shape's properties, and registers them using the existing `setPropertyRegistryEntry` / `setRelationRegistryEntry` helpers from `decorators.ts`.

**Key logic — backward-compat flag value recovery:**

Old Flux SHACL shapes (persisted before `sh:hasValue` was stored on the property shape) carry the flag value only inside `shape.constructor_actions` as the `target` of an `addLink` action. Without this recovery, `fromSHACL()` produces a class that queries without a type-discriminator triple, returning all node types instead of just the target model.

Fix:
1. Before iterating properties, build a `Map<predicate, flagValue>` from `shape.constructor_actions`
2. For each property: `resolvedHasValue = prop.hasValue ?? flagValueFromConstructor.get(prop.path)`
3. If `resolvedHasValue` is defined, register the property as a flag entry (hidden from data, emits fixed triple in SPARQL) and `continue` — don't register it as a user field
4. Otherwise register as property (scalar, `maxCount === 1`) or relation (collection)

**Note:** `fromSHACL()` was absent from `sparql-1.2-cleanup` — this is a net addition, not a restoration.

---

### 2. `core/src/model/index.ts`

No changes needed — `Ad4mModel` is already exported via `export * from "./Ad4mModel"`.

---

### 3. `core/src/model/Ad4mModel.test.ts`

One new `describe` block:

**`Ad4mModel.fromSHACL()`** — ~14 unit tests covering:
- `className` assignment
- Scalar property registration (`maxCount === 1`)
- Collection/relation registration (no `maxCount` or `> 1`)
- `resolveLanguage` propagation
- `writable: false` → `readOnly: true`
- Flag property (`hasValue`) registered as type-discrimination entry (not user field)
- Flag property from `fromSHACL` produces correct SPARQL type-discriminator triple
- Backward-compat: flag value recovered from `constructor_actions` when `hasValue` is absent on the property shape
- Properties without a `name` field skipped
- `local` flag propagated to relations
- Empty shape → empty metadata

---

## What is NOT in this PR

- `getModelManifest()` — lives in WE (calls `perspective.getAllShacl()` and transforms the result; no internal registry access needed, so it does not belong in core)
- `fromSHACL` does not handle `getter`-backed relation properties (out of scope — cleanup's Rust engine evaluates getters server-side; no TS consumer needs to reconstruct them from SHACL)
- No changes to `ModelQueryBuilder`, `hydration.ts`, or the Rust layer
- No changes to Flux or WE — those are consuming this API; they follow in later work

---

## Files Changed

| File | Change |
|---|---|
| `core/src/model/Ad4mModel.ts` | Add `fromSHACL()` static method |
| `core/src/model/Ad4mModel.test.ts` | Add `fromSHACL()` test suite |

No new files. No Rust changes. No deletions. `PerspectiveProxy.ts` untouched.

---

## Validation

Run existing test suite — no existing tests should break (all changes are additive).

```bash
cd core && pnpm test
```

Expected: all 153 existing `Ad4mModel` tests still pass + new tests added.
