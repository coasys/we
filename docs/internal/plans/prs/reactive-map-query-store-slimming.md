# PR Plan: Reactive `$map` + `$query` — Store Slimming

## Overview

Enable `$query` as the `items` source inside `$map`, wire reactive subscriptions through `SchemaRenderer`, migrate the `Space` model from `HasMany` to `HasOne` for locations, and replace the computed globe-pin logic currently baked into `SpaceStore` with declarative schema tokens. The result is a store that holds only imperative action logic and state that genuinely belongs there, with all data-fetching and transformation expressed in the template.

---

## Motivation

`SpaceStore` currently contains several derived signals that are purely presentational — they exist only to build the arrays consumed by `CesiumGlobe`. Keeping them in the store:

- Makes the store harder to understand and extend
- Ties the globe's data shape to the store, so template authors can't change what the pins show without editing TypeScript
- Prevents the subscription system from handling refresh automatically (the store manually invalidates on `creatingSpace` events instead)
- Defeats one of the core goals of the schema system: moving data logic into templates where AI and users can edit it without touching app code

---

## Current State

`SpaceStore` contains:

```typescript
// Fetch (buildDiscoveryData — called imperatively)
const [childSpaces, setChildSpaces] = createSignal<Space[]>([]);
const [members, setMembers] = createSignal<AgentProfile[]>([]);
const [signalTypes, setSignalTypes] = createSignal<SignalType[]>([]);

// Derived pin arrays (computed from the above)
const spaceLocationPins = createMemo<GlobePin[]>(() => childSpaces().flatMap(...));
const memberLocationPins = createMemo<GlobePin[]>(() => members().flatMap(...));

// Derived selection (computed from pin + source arrays)
const selectedSpace = createMemo<Space | null>(...);
const selectedAgent = createMemo<AgentProfile | null>(...);
```

The `CesiumGlobe` schema reads `spaceStore.spaceLocationPins` and `spaceStore.memberLocationPins` via `$store` tokens. The `SpaceModal` and `AgentModal` read `spaceStore.selectedSpace.*` and `spaceStore.selectedAgent.*`.

The globe-pin construction also currently produces `signalEnergy: 0` for all pins because the `buildDiscoveryData` fetch doesn't include signals — the `$signalCount` cast is a known dead path.

---

## Target State

### Globe layers (in template)

```json
{
  "factory": "pointLocationsLayer",
  "id": "space-locations",
  "enabled": { "$local": "showSpaceLocations" },
  "options": {
    "locations": {
      "$map": {
        "items": {
          "$query": {
            "model": "Space",
            "where": { "location": { "$ne": null } },
            "include": {
              "location": true,
              "$totalSignals": { "from": "signals", "count": true }
            },
            "subscribe": true
          }
        },
        "select": {
          "id": "$item.id",
          "kind": "space",
          "name": "$item.name",
          "latitude": "$item.location.latitude",
          "longitude": "$item.location.longitude",
          "avatar": "$item.avatar",
          "signalEnergy": "$item.$totalSignals"
        }
      }
    },
    "markerSize": 20,
    "defaultColor": "#a855f7",
    "onLocationClick": { "$action": "spaceStore.setSelectedPin", "args": ["$arg"] }
  }
}
```

```json
{
  "factory": "pointLocationsLayer",
  "id": "agent-locations",
  "enabled": { "$local": "showUserLocations" },
  "options": {
    "locations": {
      "$map": {
        "items": {
          "$query": {
            "model": "AgentProfile",
            "where": { "location": { "$ne": null } },
            "include": {
              "location": true,
              "$totalSignals": { "from": "signals", "count": true }
            },
            "subscribe": true
          }
        },
        "select": {
          "id": "$item.id",
          "kind": "agent",
          "name": { "$concat": ["$item.firstName", " ", "$item.lastName"] },
          "latitude": "$item.location.latitude",
          "longitude": "$item.location.longitude",
          "avatar": "$item.avatar",
          "signalEnergy": "$item.$totalSignals"
        }
      }
    },
    "markerSize": 30,
    "defaultColor": "#f97316",
    "onLocationClick": { "$action": "spaceStore.setSelectedPin", "args": ["$arg"] }
  }
}
```

### Modals (`SpaceModal` / `AgentModal`)

Currently read `spaceStore.selectedSpace.*` — a computed memo populated by searching `childSpaces`. Once `childSpaces` leaves the store, the modal wraps its body in a `$each` + `$query` that fetches exactly the clicked entity by ID:

```json
{
  "type": "$each",
  "props": {
    "as": "item",
    "items": {
      "$query": {
        "model": "Space",
        "where": { "id": { "$store": "spaceStore.selectedPin.id" } },
        "subscribe": false
      }
    }
  },
  "children": [{ "type": "we-text", "children": ["$item.name"] }]
}
```

Note: `$each` is used here as a "maybe-bind" — it renders 0 or 1 times depending on whether the query returns a result.

### `selectedPin` — kept in store (not moved to `$localState`)

Although `$local` now supports dot-path navigation (`{ $local: 'selectedPin.kind' }`), `selectedPin` stays as a store signal. Moving it to `$localState` would break `loadEntitySignalData`, a `createEffect` in `SpaceStore` that reacts to `selectedPin()` to load signal controls whenever the selected entity changes. Since that imperative reaction cannot be expressed declaratively in the current schema system, `selectedPin` remains store-managed and `onLocationClick` keeps `{ $action: 'spaceStore.setSelectedPin', args: ['$arg'] }`.

The `$local` dot-path feature is available for view state that has no store-side reactions (e.g. toggle flags, form state).

### `SpaceStore` after

Signals/memos removed:

- `childSpaces` / `setChildSpaces`
- `members` / `setMembers`
- `spaceLocationPins` (memo)
- `memberLocationPins` (memo)
- `selectedSpace` (memo)
- `selectedAgent` (memo)
- `GlobePin` type export (moves to schema types or is inlined)

Signals kept:

- `signalTypes` / `signalTypesBySlug` — required by `upsertEntitySignal`, `createSignalType`, and `CardsRoute` schemas
- `selectedPin` — still managed imperatively (set by globe click action, cleared by modal close)
- `selectedEntitySignalData` / `selectedEntitySignals` — still needed for entity react bar
- All hydration state (`perspective`, `space`, `loading`, etc.)

The `buildDiscoveryData` helper and the `creatingSpace` refresh effect are also removed — subscriptions handle refresh automatically.

---

## Changes Required

### 1. `Space` model — `HasMany` → `HasOne` for location

**File:** `packages/models/src/entities/Space.ts`

Change:

```typescript
@HasMany(() => LocationBlock, { through: 'we://location' })
locations: LocationBlock[] = [];
```

To:

```typescript
@HasOne(() => LocationBlock, { through: 'we://location' })
location?: LocationBlock;
```

Also update the `Space` interface augmentation to expose `setLocation` (matching `AgentProfile`), replacing the `HasManyMethods<'locations'>` augmentation.

Update all call sites in `syncHelpers.ts` that currently use `space.locations` / `addLocations` to use `space.location` / `setLocation`.

### 2. `SchemaRenderer` — reactive `$query` inside `$map.items`

**File:** `packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx`

Currently `resolveMapProp` is a pure synchronous transform — it calls `resolvePropFn(map.items, ...)` which for a `$query` token returns only a `QueryDescriptor` object, never wires a Solid subscription.

The fix: detect `$query` on `map.items` in `SchemaRenderer` **before** delegating to `resolveMapProp`, set up a `createQuerySignal`, and pass the resulting reactive signal as `map.items` to the resolver. The resolver already handles reactive signals via its `typeof items === 'function' ? items() : items` unwrap.

Concretely, in the prop-resolution loop inside `RenderSchema` — where it detects `hasToken(rawValue, '$map', 'object')` — add a pre-pass:

```typescript
} else if (hasToken(rawValue, '$map', 'object')) {
  const mapSpec = (rawValue as { $map: MapProp }).$map;
  if (hasToken(mapSpec.items, '$query', 'object')) {
    // Wire reactive subscription for the items source
    const descriptor = resolveQueryProp(mapSpec.items);
    const getModel = (stores as Record<string, unknown>).$getModel as ((name: string) => unknown) | undefined;
    if (getModel) {
      const itemsSignal = createQuerySignal(descriptor, stores, getModel);
      // Replace items with the live signal before handing to resolveMapProp
      propMemos[key] = createMemo(() =>
        deepUnwrap(resolveProp({ $map: { ...mapSpec, items: itemsSignal } }, stores, effectiveContext, createMemo))
      );
    }
  } else {
    // existing path
  }
}
```

This keeps `resolveMapProp` pure and untouched — the subscription concern stays in `SchemaRenderer`.

The same pattern applies for `$forEach.items` (already done) and can be applied consistently here.

### 3. `$query` Zod schema — add `perspectiveStore` to zod

**File:** `packages/schema-system/shared/src/zodSchemas.ts`

`perspectiveStore` is already in the TypeScript `QueryToken` type but missing from `zQueryToken`. Add it:

```typescript
perspectiveStore: z.string().optional(),
```

This is a small correctness fix, not strictly required for this feature but worth including.

### 4. `GlobeRoute` schema — replace `$store` with `$map`+`$query`

**File:** `packages/app-framework/src/shared/schemas/DefaultTemplate/routes/GlobeRoute/index.ts`

Replace the two `pointLocationsLayer` `options.locations` values:

- `{ $store: 'spaceStore.spaceLocationPins' }` → `$map` + `$query` as shown in Target State above
- `{ $store: 'spaceStore.memberLocationPins' }` → same pattern for `AgentProfile`

### 5. `SpaceModal` / `AgentModal` — replace `selectedSpace`/`selectedAgent` store refs

**Files:**

- `packages/app-framework/src/shared/schemas/DefaultTemplate/routes/GlobeRoute/SpaceModal.ts`
- `packages/app-framework/src/shared/schemas/DefaultTemplate/routes/GlobeRoute/AgentModal.ts`

Wrap content in `$each` + `$query` bound to `spaceStore.selectedPin.id`. Replace all `$store: 'spaceStore.selectedSpace.*'` refs with `$item.*` context refs. Same for agent modal.

### 6. `SpaceStore` — remove derived/fetched signals

**File:** `packages/app-framework/src/frameworks/solid/stores/SpaceStore.tsx`

Remove:

- `childSpaces` signal + setter
- `members` signal + setter
- `spaceLocationPins` memo
- `memberLocationPins` memo
- `selectedSpace` memo
- `selectedAgent` memo
- `buildDiscoveryData` call in the main hydration effect
- The `creatingSpace` refresh effect
- The own-profile patch effect (patching `members` — no longer needed)

Keep:

- `selectedPin` signal + `setSelectedPin` / `clearSelectedPin` — required for `loadEntitySignalData` effect
- `selectedEntitySignalData` / `selectedEntitySignals` — required for signal controls in modals

Update `SpaceStore` interface to remove the corresponding exported members.

### 7. `syncHelpers.ts` — update `Space` call sites

**File:** `packages/app-framework/src/frameworks/solid/stores/syncHelpers.ts`

- Replace `space.locations` with `space.location` in `buildDiscoveryData` (which is being removed anyway)
- Replace `addLocations` with `setLocation` in `syncSpaceToParent`
- Remove `GlobePin` and `DiscoveryData` interfaces (or keep `GlobePin` if still referenced elsewhere)

---

## What Does NOT Change

- `signalTypes` / `signalTypesBySlug` stay in the store — action logic depends on them
- `selectedPin` stays in the store — `setSelectedPin` / `clearSelectedPin` actions kept; `loadEntitySignalData` is a `createEffect` in the store that depends on `selectedPin()` reactively
- `selectedEntitySignalData` / `selectedEntitySignals` stay — loaded imperatively on pin selection
- `upsertEntitySignal`, `upsertSignal`, `createSignalType` actions are untouched
- `GlobeRoute` layer toggle controls and modal open/close logic are untouched
- The `$eq`/`$store` condition on the outer `$if` that gates each modal is untouched (uses `$store: 'spaceStore.selectedPin.kind'`)

---

## Ordering

1. `Space` model: `HasMany` → `HasOne` + `syncHelpers.ts` call sites
2. `SchemaRenderer`: reactive `$query` in `$map.items`
3. `GlobeRoute` schema: swap `$store` for `$map`+`$query`
4. `SpaceModal` / `AgentModal`: swap `selectedSpace`/`selectedAgent` for `$each`+`$query`
5. `SpaceStore`: remove now-unused signals and effects
6. Zod fix for `perspectiveStore` (can be batched with step 2)

Steps 1 and 2 are independent. Steps 3–5 depend on both being done. Step 6 is standalone.

---

## Testing Checklist

- [ ] Space pins appear on globe with correct position and avatar
- [ ] Agent pins appear on globe with correct position and avatar
- [ ] `signalEnergy` on pins reflects real signal count (previously always 0)
- [ ] New space created → pin appears without page reload (subscription fires)
- [ ] Clicking a space pin opens `SpaceModal` with correct name/description/avatar
- [ ] Clicking an agent pin opens `AgentModal` with correct name/handle/avatar
- [ ] Closing a modal clears the pin selection
- [ ] `SpaceStore` no longer exposes `childSpaces`, `members`, `spaceLocationPins`, `memberLocationPins`, `selectedSpace`, `selectedAgent`
- [ ] `syncSpaceToParent` correctly uses `setLocation` instead of `addLocations`
- [ ] Existing `CardsRoute` signal wiring is unaffected
