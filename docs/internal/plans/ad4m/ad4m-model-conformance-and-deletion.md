# Plan: Fix Ad4mModel conformance filtering and flag-less model deletion

> Unblock models with all-optional properties (no `@Flag`, no `required`) from
> conformance-filtered `@HasMany` hydration and from `delete()`.

---

## Problem

Two independent bugs share the same root cause: Ad4mModel assumes every model has
at least one `@Flag` or `required: true` property. Models that don't meet this
assumption hit failures in **conformance filtering** and **deletion**.

### 1. `buildConformanceFilter` returns `undefined` for flag-less models

When a `@HasMany` relation targets a model with no flags and no required
properties, `buildConformanceFilter` (decorators.ts ~L176) finds zero conditions
and returns `undefined`. This produces two runtime warnings:

```
[Ad4mModel] buildConformanceGetter: no conditions found for target "Theme".
[Ad4mModel] buildConformanceGetter returned undefined for relation "installedThemes" (predicate: "we://installed_theme")
```

The relation still hydrates (falls back to unfiltered link traversal), but
without conformance filtering it can match links belonging to unrelated models
sharing the same base expression — incorrect results in overlapping graph
patterns.

### 2. `removeLinks` fails with Apollo `__typename` fields

`Ad4mModel.delete()` checks `hasDestructor` using the same flag/required/initial
heuristic. When it's `false`, the non-destructor branch fetches outgoing links
via `perspective.get()` and passes them to `perspective.removeLinks()`. Apollo
Client injects `__typename` into every returned link object, and `removeLinks`
doesn't strip them before the mutation — GraphQL validation rejects every element:

```
ApolloError: Variable "$links" got invalid value.
  In element #0: In field "__typename": Unknown field.
```

### Current workaround

Add a `@Flag` to every model. This works but defeats the design goal of matching
graph patterns by their declared predicates alone.

---

## Affected models (WE)

| Model           | @Flag | required | Affected by conformance bug           | Affected by delete bug |
| --------------- | ----- | -------- | ------------------------------------- | ---------------------- |
| Theme           | ✗     | ✗        | ✓ (via AgentSettings.installedThemes) | ✓                      |
| WeNode          | ✗     | ✗        | ✓ (via CollectionBlock.children)      | ✓                      |
| EmbedBlock      | ✗     | ✗        | ✓ (if targeted by @HasMany)           | ✓                      |
| CalloutBlock    | ✗     | ✗        | ✓                                     | ✓                      |
| CollectionBlock | ✗     | ✗        | ✓                                     | ✓                      |
| DividerBlock    | ✗     | ✗        | ✓                                     | ✓                      |

Models with `@Flag` or `required` are not affected.

---

## Fix 1: Property-existence fallback in `buildConformanceFilter`

### Change

Add a third phase to `buildConformanceFilter` that fires only when phases 1
(flags) and 2 (required properties) found nothing. It collects all non-getter,
non-flag properties that have a `through` predicate and adds them as existence
checks:

```typescript
// Phase 3 (NEW): If no flags or required properties, use ALL declared
// property predicates as existence-based conformance conditions.
// This matches the model's full graph pattern — a node conforms if it
// has links for every predicate the model declares.
if (conditions.length === 0) {
  for (const [_propName, propMeta] of Object.entries(targetProps)) {
    if (!propMeta.flag && !propMeta.getter && propMeta.through) {
      conditions.push({
        type: 'property',
        predicate: propMeta.through,
      });
      sparqlConditions.push(`?target <${escapeQueryString(propMeta.through)}> ?_v${varIdx++} .`);
    }
  }
}

if (conditions.length === 0) {
  return undefined; // Truly empty model — nothing to filter on
}
```

### Type change

Extend `ConformanceCondition.type` to include `'property'`:

```typescript
export interface ConformanceCondition {
  type: 'flag' | 'required' | 'property';
  predicate: string;
  value?: string;
}
```

### Behaviour

- Models with flags/required: **no change** (phases 1–2 produce conditions, phase 3 is skipped)
- Theme (6 property predicates): generates a SPARQL pattern requiring all 6 predicates to exist on the target node — a strong conformance signal without any flags
- Empty models (no properties at all): still returns `undefined`, same as today

### Strictness consideration

Requiring ALL property predicates may be too strict for models where some
properties are genuinely optional and may not have links yet (e.g. a freshly
created Theme with only `name` set). Two options:

- **Option A (strict):** Require all predicates. This matches the "graph pattern"
  intent and models should ensure required links exist on creation. This is the
  recommended default.
- **Option B (lenient):** Require at least N predicates (e.g. ≥2), or use
  `OPTIONAL` in SPARQL for some. More complex, less deterministic.

Recommend **Option A** to start — if a model's instance doesn't have all its
properties linked, that's arguably a data integrity problem to fix at the
creation site, not at the conformance filter.

---

## Fix 2: Strip `__typename` in `PerspectiveProxy.removeLinks`

### Change

In `PerspectiveProxy.removeLinks()` (~L616), strip `__typename` from link
objects before passing to the client mutation. This matches the pattern already
used in `PerspectiveProxy.setSingleTarget()` (~L846) and
`PerspectiveClient.addLinks()` (~L364):

```typescript
async removeLinks(links: LinkExpressionInput[], batchId?: string): Promise<LinkExpression[]> {
    for (const l of links) {
        delete (l as any).__typename;
        delete (l as any).data?.__typename;
        delete (l as any).proof?.__typename;
    }
    const result = await this.#client.removeLinks(this.#handle.uuid, links, batchId);
    invalidatePerspectiveCache(this.#handle.uuid);
    return result;
}
```

This is a standalone fix — it unblocks deletion for ALL models regardless of the
conformance filter change. The same stripping pattern already exists in at least
three other places in the codebase (`AgentClient`, `PerspectiveClient.addLinks`,
`PerspectiveProxy.setSingleTarget`).

---

## Scope

### In scope

- [ ] Add `'property'` to `ConformanceCondition.type` (SHACLShape.ts)
- [ ] Add phase-3 fallback in `buildConformanceFilter` (decorators.ts)
- [ ] Strip `__typename` in `PerspectiveProxy.removeLinks` (PerspectiveProxy.ts)
- [ ] Tests: conformance filter generates conditions for flag-less models
- [ ] Tests: conformance filter still prefers flags/required when present
- [ ] Tests: `removeLinks` succeeds with `__typename`-contaminated input
- [ ] Tests: `delete()` works for all-optional models

### Out of scope

- Polymorphic `@HasMany` (separate plan, builds on this)
- Changing existing models to add/remove flags
- `hasDestructor` rework in `delete()` — the non-destructor branch is correct in
  principle (scoped removal of own predicates); it just needs `__typename`
  stripping to work

---

## Files to modify

| File                                        | Change                                          |
| ------------------------------------------- | ----------------------------------------------- |
| `core/src/shacl/SHACLShape.ts`              | Add `'property'` to `ConformanceCondition.type` |
| `core/src/model/decorators.ts`              | Phase-3 fallback in `buildConformanceFilter`    |
| `core/src/perspectives/PerspectiveProxy.ts` | `__typename` stripping in `removeLinks`         |
| `core/src/model/relation-filtering.test.ts` | New tests for property-existence conformance    |

---

## Commit plan

| #   | Scope                    | Description                                             |
| --- | ------------------------ | ------------------------------------------------------- |
| 1   | `removeLinks`            | Strip `__typename` from link objects before mutation    |
| 2   | Conformance type         | Add `'property'` to `ConformanceCondition` union        |
| 3   | `buildConformanceFilter` | Phase-3 fallback using all declared property predicates |
| 4   | Tests                    | Conformance + deletion tests for flag-less models       |

Commits 1 and 2–3 are independent and can be reviewed/merged separately.

---

## Relationship to other plans

- **[polymorphic-has-many.md](polymorphic-has-many.md):** Polymorphic `@HasMany`
  resolves types per-child via `subject_class`, bypassing conformance filtering
  entirely for heterogeneous collections. This plan fixes the non-polymorphic
  path (homogeneous `@HasMany` like `AgentSettings.installedThemes`). Both are
  needed.
- **[removeLinks-typename-bug.md](removeLinks-typename-bug.md):** Fix 2 in this
  plan is the resolution of that bug report. That doc can be closed once this
  ships.
