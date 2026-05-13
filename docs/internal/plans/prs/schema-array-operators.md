# PR Plan: Schema Array Operators — `$filter`, `$count`, `$find`

## Overview

Add three new schema tokens that operate on already-fetched arrays in template context: `$filter`, `$count`, and `$find`. Together they allow templates to express cross-referencing of two query results — for example, joining a list of `SignalType` entries with the signals already included on a fetched entity — without requiring any store scaffolding or bespoke component logic.

---

## Motivation

The current schema system can query the database (`$query`), iterate results (`$each`), and map over arrays (`$map`). What it cannot do is operate on a sub-array of an already-fetched result. This gap surfaces immediately in the globe modals:

**Current state (store-dependent):**

The `SpaceModal` and `AgentModal` iterate `spaceStore.selectedEntitySignalData` — a pre-joined array computed imperatively in `SpaceStore.loadEntitySignalData`. The store fetches the entity with `include: { signals: true }`, groups signals by type, and produces `{ signalType, totalValue, myValue }` rows. This means:

- Signal types must be kept in the store (`signalTypes` signal)
- The join happens in TypeScript, not the template
- Templates cannot adapt to community-specific signal types without touching store code

**Target state (store-free signal controls):**

```json
{
  "type": "$each",
  "props": {
    "items": { "$query": { "model": "SignalType", "subscribe": true } },
    "as": "sig"
  },
  "children": [{
    "type": "SignalControl",
    "props": {
      "signalType": "$sig",
      "aggregate": {
        "$count": {
          "items": {
            "$filter": {
              "items": "$item.signals",
              "where": { "signalTypeId": "$sig.id" }
            }
          }
        }
      },
      "myValue": {
        "$find": {
          "items": "$item.signals",
          "where": {
            "signalTypeId": "$sig.id",
            "author": { "$store": "adamStore.me.did" }
          },
          "select": "value"
        }
      },
      "onSignal": {
        "$action": "spaceStore.upsertEntitySignal",
        "args": ["$sig.id", "$arg"]
      }
    }
  }]
}
```

Note: The outer `$each`+`$query` in the modal already fetches `$item` with `include: { signals: true }`. The `$filter`/`$count`/`$find` tokens operate on the already-present `$item.signals` array — no additional network calls.

---

## Why This Is the Right Architecture

Signals are the first case, but the pattern is general. Any m:n relation accessed from the template layer hits the same wall:

- Posts with tags — filter post's tags by selected category
- Members with roles — find a member's specific role
- Entities with comments — count comments by author
- Any aggregate over an included relation

Option A (smart `SignalControl` that queries internally) was considered and rejected:
- Breaks `SignalControl`'s pure rendering contract (currently it only accepts pre-computed `myValue`/`aggregate`)
- Requires the component to know how to write signals too (upsert action coupling)
- Doesn't generalise — every component that needs a similar pattern would need the same treatment
- Creates a precedent for query logic living inside components

Option B (these schema operators) generalises cleanly: the AI reasoning overhead is minimal because `$filter`/`$count`/`$find` have the same mental model as `$query where`/`count`/`limit: 1`, just applied to an in-memory array.

---

## Token Definitions

### `$filter`

Returns a subset of an array where all conditions in `where` match.

```typescript
interface FilterToken {
  $filter: {
    items: SchemaProp;        // resolves to an array
    where: Record<string, SchemaProp>;  // same predicate shape as $query.where
  };
}
```

Example:
```json
{ "$filter": { "items": "$item.signals", "where": { "signalTypeId": "$sig.id" } } }
```

### `$count`

Returns the length of an array.

```typescript
interface CountToken {
  $count: {
    items: SchemaProp;        // resolves to an array
  };
}
```

Convenience: `{ "$count": { "items": ... } }` is equivalent to `Array.length` after filtering.

### `$find`

Returns the first element matching `where`, optionally plucking a single field via `select`.

```typescript
interface FindToken {
  $find: {
    items: SchemaProp;
    where: Record<string, SchemaProp>;
    select?: string;           // if present, returns item[select] instead of the item
  };
}
```

Example — get my vote value:
```json
{
  "$find": {
    "items": "$item.signals",
    "where": { "signalTypeId": "$sig.id", "author": { "$store": "adamStore.me.did" } },
    "select": "value"
  }
}
```

Returns `undefined` (not null) if no match — consistent with `Array.prototype.find`.

---

## Changes Required

### 1. TypeScript types

**File:** `packages/schema-system/shared/src/types.ts`

Add `FilterToken`, `CountToken`, `FindToken` to the `SchemaProp` union.

```typescript
export interface FilterToken {
  $filter: { items: SchemaProp; where: Record<string, SchemaProp> };
}
export interface CountToken {
  $count: { items: SchemaProp };
}
export interface FindToken {
  $find: { items: SchemaProp; where?: Record<string, SchemaProp>; select?: string };
}
```

Add to `SchemaProp` union alongside `MapToken`, `PickToken`, etc.

### 2. Zod schemas

**File:** `packages/schema-system/shared/src/zodSchemas.ts`

```typescript
const zFilterToken = z.object({
  $filter: z.object({
    items: zDefined,
    where: z.record(z.string(), z.unknown()),
  }),
}).strict();

const zCountToken = z.object({
  $count: z.object({
    items: zDefined,
  }),
}).strict();

const zFindToken = z.object({
  $find: z.object({
    items: zDefined,
    where: z.record(z.string(), z.unknown()).optional(),
    select: z.string().optional(),
  }),
}).strict();
```

Add all three to `zPropToken` union.

### 3. Prop resolver

**File:** `packages/schema-system/shared/src/propResolvers/resolve.ts` (or wherever `resolveProp` dispatches)

Add cases for `$filter`, `$count`, `$find`. The where-matching logic reuses the same predicate evaluation already used for `$query where` conditions (or a lightweight in-memory equivalent — at minimum, strict equality per key, supporting `$store`/`$local` resolution for comparison values).

```typescript
// $filter
if (hasToken(value, '$filter', 'object')) {
  const { items, where } = value.$filter;
  const arr = resolveProp(items, stores, context, createMemo) as unknown[];
  if (!Array.isArray(arr)) return [];
  return arr.filter(item => matchesWhere(item, where, stores, context, createMemo));
}

// $count
if (hasToken(value, '$count', 'object')) {
  const arr = resolveProp(value.$count.items, stores, context, createMemo);
  return Array.isArray(arr) ? arr.length : 0;
}

// $find
if (hasToken(value, '$find', 'object')) {
  const { items, where, select } = value.$find;
  const arr = resolveProp(items, stores, context, createMemo) as unknown[];
  if (!Array.isArray(arr)) return undefined;
  const match = where ? arr.find(item => matchesWhere(item, where, stores, context, createMemo)) : arr[0];
  if (match === undefined) return undefined;
  return select ? (match as Record<string, unknown>)[select] : match;
}
```

The `matchesWhere` helper evaluates each key in the `where` record against the item's corresponding property. It must support:
- Plain scalar values (strict equality)
- `{ $store: '...' }` — resolved at call time via `resolveProp`
- `{ $local: '...' }` — same
- `{ $ne: [...] }`, `{ $eq: [...] }` — already-defined comparison tokens

This `matchesWhere` helper is likely already partially implemented for `$query where` clause evaluation and can be shared or extracted.

### 4. Zod validator additions

**File:** `packages/schema-system/shared/src/zodSchemas.ts`

Add `zFilterToken`, `zCountToken`, `zFindToken` to the `zPropToken` union (same place as the others).

### 5. Update modals to use new operators

**Files:**
- `packages/app-framework/src/shared/schemas/DefaultTemplate/routes/GlobeRoute/SpaceModal.ts`
- `packages/app-framework/src/shared/schemas/DefaultTemplate/routes/GlobeRoute/AgentModal.ts`

Replace the `{ $store: 'spaceStore.selectedEntitySignalData' }` `$each` with the dynamic `$query { model: 'SignalType' }` + `$filter`/`$count`/`$find` pattern shown in the Target State section above.

Requires updating the entity `$query` in the outer `$each` to add `include: { signals: true }`.

### 6. Remove signal aggregation from SpaceStore

**File:** `packages/app-framework/src/frameworks/solid/stores/SpaceStore.tsx`

Once the modals no longer depend on `selectedEntitySignalData`:

- Remove `loadEntitySignalData` function
- Remove `selectedEntitySignalData` signal + setter
- Remove `selectedEntitySignals` signal + setter (used only inside `loadEntitySignalData` and `upsertEntitySignal`)
- Simplify `upsertEntitySignal` — it no longer needs to call `loadEntitySignalData` after write; it can just call `Signal.create`/`save`/`delete` directly
- Remove `selectedEntitySignalData` from `SpaceStore` interface

Update `upsertEntitySignal` to accept `nodeId` as an explicit argument (passed from template context `$item.id`) rather than reading `selectedPin()`, which allows `selectedPin` to eventually move to `$localState` in a future PR.

### 7. Plan: `selectedPin` → `$localState` (future, unlocked by step 6)

Once `upsertEntitySignal` takes an explicit `nodeId` argument, `selectedPin` has no remaining store-side reactions and can move to `$localState`. This is a separate small PR.

---

## What Does NOT Change

- `SignalControl` component — still purely presentational (`signalType`, `myValue`, `aggregate`, `onSignal`)
- `upsertEntitySignal` action — kept in store (write path belongs there)
- `signalTypes` / `signalTypesBySlug` — still used by `CardsRoute` PostsList schemas (the `$include` aggregation approach) and `createSignalType` action
- PostsList schema — not changed; it uses `$include` aggregation descriptors which are a different (eager, SQL-level) approach appropriate for list views
- `onLocationClick` / `setSelectedPin` — unchanged

---

## `matchesWhere` predicate support

The minimum viable implementation only needs to support equality checks for the signal use case:

```json
{ "signalTypeId": "$sig.id", "author": { "$store": "adamStore.me.did" } }
```

That's: resolve each value (string context ref or `$store` token), compare to the item's field by strict equality.

For completeness, operators worth supporting in v1:
- Plain scalar (strict `===`)
- `$store` / `$local` / `$item.*` context refs
- `{ $ne: [a, b] }` — not-equal
- `{ $in: [value, array] }` — membership

Complex operators (`$and`, `$or`, `$lt`, `$gt`) can be deferred — they're not needed for the signal case.

---

## Testing Checklist

- [ ] `$filter` returns correct subset of `$item.signals` by `signalTypeId`
- [ ] `$count` returns correct integer for filtered signals
- [ ] `$find` returns correct item; `select` plucks scalar field; returns `undefined` for no match
- [ ] `$store` and context refs inside `where` resolve correctly at render time
- [ ] `SpaceModal` signal controls render correctly for all signal types in a community
- [ ] `AgentModal` signal controls render correctly
- [ ] Signal controls still work (vote/toggle/rating interactions call `upsertEntitySignal`)
- [ ] Community with zero signal types: signal row does not render (empty `$each`)
- [ ] Community with 3 signal types: all 3 controls render with correct counts
- [ ] Adding a new signal type to a community → modal updates without reload (subscribe: true on SignalType query)
- [ ] `SpaceStore.selectedEntitySignalData` no longer exists / is no longer exported
- [ ] Existing CardsRoute PostsList signals are unaffected

---

## Ordering

1. Types + Zod (`FilterToken`, `CountToken`, `FindToken`) — standalone, no dependencies
2. `matchesWhere` helper — can be scaffolded in isolation
3. `resolveProp` dispatch cases — depends on 1 and 2
4. Rebuild `@we/schema-shared` dist
5. Update modals to use new operators (step 5 above)
6. Remove `loadEntitySignalData` / `selectedEntitySignalData` from SpaceStore (step 6 above)

Steps 1–4 are all within `packages/schema-system`. Steps 5–6 are in `packages/app-framework`.
