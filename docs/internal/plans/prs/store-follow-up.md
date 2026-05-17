# PR Plan: Store Follow-Up — Model Store Unification, Space Signal Removal, Location Refactor

## Overview

Three sequentially-ordered improvements following the store-optimisation PR.
Each is independently shippable but listed in dependency order.

---

## Task 1 — Rename `perspectiveStore` → `perspective` in `$query` tokens

**Why first:** Pure mechanical rename with no logic change. All subsequent plans use
`$query`, so establishing clean naming before writing new schemas avoids a second
rename pass.

### What changes

| Location                                                         | Change                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `packages/schema-system/shared/src/types.ts`                     | Rename `perspectiveStore?` → `perspective?` on `QueryDescriptor` and its source type |
| `packages/schema-system/shared/src/zodSchemas.ts`                | Rename field in the zod schema                                                       |
| `packages/schema-system/shared/src/propResolvers/query.ts`       | Destructure `perspective` instead of `perspectiveStore`                              |
| `packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx` | Update both resolution sites to read `descriptor.perspective`                        |
| All `.schema.ts` / `.ts` template files                          | Rename the key in every `$query` literal                                             |
| `packages/ai-context/src/fragments/schema-operators.ts`          | Update docs                                                                          |
| `packages/ai-context/src/fragments/store-patterns.ts`            | Update examples                                                                      |

### Template files to update

- `Profile.schema.ts` — `perspectiveStore: 'adamStore.rootPerspective'`
- `SchemaTokens.schema.ts` — two occurrences of `perspectiveStore: 'testStore.perspective'`
- `ChannelList.ts` (×2), `ConversationList.ts` — `perspectiveStore: 'adamStore.currentPerspective'`

### No backward-compatibility concern

All schemas are compiled TypeScript — no persisted JSON uses `perspectiveStore`
in the current codebase.

---

## Task 2 — Unify modelStore: add `perspective` option, remove `rootModel`

**Why second:** `rootModel` was added as a quick solution in the previous PR.
Replacing it with a first-class `perspective` option on the single `model` store
is cleaner and scales to any perspective — not just root. Task 3 (location) and
Task 4 (space) both benefit from a clean modelStore API before new schema tokens
are written.

### The problem

`rootModel` duplicates the entire `model` store interface pointed at a different
perspective. If a third perspective is ever needed (e.g. a community perspective),
a third store object would be required.

### Design

Add an optional `perspective` field to the options argument of `create`, `update`,
and `delete` in the `model` store. The value is a dot-path string resolved against
the stores object at call time — the same convention `$query`'s `perspective` field
uses (after Task 1's rename).

```ts
// TemplateProvider.tsx — modelStore
const modelStore = {
  create: (
    modelName: string,
    data = {},
    options?: { perspective?: string; parent?: { model: string; id: string; field?: string }; [k: string]: unknown },
  ) => {
    const p = resolvePerspective(options?.perspective) ?? adamStore.currentPerspective()!;
    const Model = getModel(modelName);
    const resolvedParent = options?.parent
      ? { model: getModel(options.parent.model), id: options.parent.id, field: options.parent.field }
      : undefined;
    return Model.create(p, data, { ...options, ...(resolvedParent && { parent: resolvedParent }) });
  },
  update: (modelName: string, id: string, data: Record<string, unknown>, options?: { perspective?: string }) => {
    const p = resolvePerspective(options?.perspective) ?? adamStore.currentPerspective()!;
    return getModel(modelName).update(p, id, data);
  },
  delete: (modelName: string, id: string, options?: { perspective?: string }) => {
    const p = resolvePerspective(options?.perspective) ?? adamStore.currentPerspective()!;
    return getModel(modelName).delete(p, id);
  },
};

// Helper — resolves a dot-path string like 'adamStore.rootPerspective' against the stores object.
// Same logic SchemaRenderer uses for $query.perspective resolution.
function resolvePerspective(path?: string): PerspectiveProxy | null {
  if (!path) return null;
  const [storeName, ...rest] = path.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let val: any = stores[storeName as keyof Stores];
  for (const key of rest) val = val?.[key];
  return typeof val === 'function' ? val() : (val ?? null);
}
```

Note: `resolvePerspective` must be defined after `stores` is constructed, since it
reads `stores`. Or it can close over the individual store references directly (simpler).

### The `parent` option in `create`

`Ad4mModel.create` accepts a `ParentScope` in two forms:

- **Model form** (preferred): `{ model: typeof Ad4mModel, id: string, field?: string }`
  — predicate auto-resolved from the parent's `@HasOne` / `@HasMany` decorator metadata.
- **Raw form**: `{ id: string, predicate: string }` — explicit predicate string.

The `modelStore.create` extension resolves the string `'AgentProfile'` → the actual
class via `getModel()`, enabling schemas to use:

```ts
{ $action: 'model.create', args: [
    'LocationBlock',
    { latitude: '$arg.latitude', longitude: '$arg.longitude', ... },
    { perspective: 'adamStore.rootPerspective', parent: { model: 'AgentProfile', id: '$profile.id', field: 'location' } }
] }
```

This creates the `LocationBlock` and links it via the `@HasOne('location')` predicate
on `AgentProfile` — the same link that `profile.setLocation(loc)` creates, so
`updateAgentLocation` in `AdamStore` can be removed (see Task 3 below).

### After this task

- Remove `rootModelStore` from `TemplateProvider.tsx`
- Remove `rootModel` from `Stores` type in `types.ts`
- Update `Profile.schema.ts` to replace `rootModel.update(...)` with
  `model.update('AgentProfile', ..., { perspective: 'adamStore.rootPerspective' })`
- Update `model` and `rootModel` entries in AI context fragments

### ModelStore type

```ts
export type ModelStore = {
  create: (modelName: string, data?: Record<string, unknown>, options?: ModelStoreOptions) => Promise<unknown>;
  update: (
    modelName: string,
    id: string,
    data: Record<string, unknown>,
    options?: { perspective?: string },
  ) => Promise<unknown>;
  delete: (modelName: string, id: string, options?: { perspective?: string }) => Promise<void>;
};

type ModelStoreOptions = {
  perspective?: string;
  parent?: { model: string; id: string; field?: string };
  [k: string]: unknown; // pass-through for any other Ad4mModel.create options
};
```

---

## Task 3 — Remove `space` signal from `SpaceStore`; use `$query` in templates

**Why third:** Independent of Task 2 in terms of code, but placing it after the
modelStore is unified means any future space-mutation schema tokens can already use the
clean `model.update(..., { perspective: ... })` API.

### Context: `syncSpaceToParent` has no callers

`syncSpaceToParent` exists in `syncHelpers.ts` but is currently never called — space
name/image changes are not synced to a parent/global perspective. This will need to
be addressed separately (requires deciding on the sync trigger point). For this task
we simply remove the reactive `space` signal and replace template consumers with `$query`.

### What changes

**`SpaceStore.tsx`**

- Remove `const [space, setSpace] = createSignal<Partial<Space | null>>(null)` and all
  `setSpace(...)` calls.
- Remove `space` from the `SpaceStore` interface.
- In `hydratePerspective` (currently called from the `createEffect` watcher):
  replace `Space.findOne(...)` with `Space.query(...).subscribe(...)` that fires on any
  Space record change in the current perspective.
- The subscription just keeps a local store-level signal (or is dropped entirely if
  nothing in the store logic needs `space()` — see below).
- `updateSpaceImage` currently reads `space()` only to spread current values into
  `setSpace(...)` — after removing `setSpace`, `updateSpaceImage` no longer needs
  the signal at all.

**After examining current `space()` usages in the store logic:**

- `updateSpaceImage` reads `space()` only as an existence guard and to spread into
  `setSpace`. Both can be dropped.
- No other store function reads `space()` internally.

So `space` can be fully removed from `SpaceStore` with no replacement signal needed
inside the store.

**Template/schema consumers** — switch from `$store` to `$query` or `$single`:

| Current                                                           | Replacement                              |
| ----------------------------------------------------------------- | ---------------------------------------- |
| `{ $store: 'spaceStore.space.coverImage' }` in `SpaceSidebar.ts`  | `$single` wrapping a `$query` on `Space` |
| `{ $store: 'spaceStore.space.avatar' }` in `SpaceSidebar.ts`      | Same                                     |
| `{ $store: 'spaceStore.space.name' }` in `SpaceSidebar.ts`        | Same                                     |
| `{ $store: 'spaceStore.space.description' }` in `SpaceSidebar.ts` | Same                                     |
| `{ $store: 'spaceStore.space.id' }` in `GlobeRoute/index.ts`      | Resolved via `$single` context           |
| Commented-out references in `Sidebar.schema.ts`                   | Already commented — no change needed     |

The `$query` for Space requires `perspective` pointing at the current space
perspective. The natural value is `'adamStore.currentPerspective'` — which is
already the default when `perspective` is omitted (after Task 1's rename cleanup).

```ts
// SpaceSidebar.ts — wrapping node
{
  type: '$single',
  props: {
    items: { $query: { model: 'Space', where: { uuid: { $store: 'adamStore.currentPerspectiveUuid' } } } },
    as: 'space',
  },
  children: [/* existing layout */],
}
```

`adamStore.currentPerspectiveUuid` should already exist or can be derived from
`currentPerspective().uuid` — check if a getter already exists.

**`SpaceStore` interface after this task:**

- `space` accessor removed
- `updateSpaceImage` signature unchanged (still public API called from schema `$action`)

### What stays in `SpaceStore`

The store is still needed for:

- `signalTypes` / `signalTypesBySlug` — no suitable `$query` replacement currently
- `createPost`, `createSignalType`, `upsertSignal`, `createAgentProfile` — imperative
  multi-step operations
- `navigateToSpace` — navigation action
- `updateSpaceImage` — image upload (compression + write)
- `isWeSpace` gating logic in the `createEffect`

---

## Task 4 — Remove `updateAgentLocation` from `AdamStore`; replace with schema tokens

**Why last:** Depends on Task 2 (modelStore `parent` option), and touches `Profile.schema.ts`
which is already changed in the previous PR.

### Current implementation

```ts
async function updateAgentLocation(lat, lng, city?, country?, countryCode?): Promise<void> {
  const loc = await LocationBlock.create(rootP, { ... });
  await profile.setLocation(loc);
  // Subscription fires on the link change and handles setAgentProfile + sync
}
```

### Replacement: schema `$action` tokens

`profile.setLocation(loc)` is equivalent to creating a `LocationBlock` with
`parent: { model: 'AgentProfile', id: profileId, field: 'location' }` (Task 2
establishes this).

In `Profile.schema.ts`, the location save button's `onClick` becomes:

```ts
onClick: {
  $action: 'model.create',
  args: [
    'LocationBlock',
    {
      latitude: { $local: 'latitude' },
      longitude: { $local: 'longitude' },
      city: { $local: 'city' },
      country: { $local: 'country' },
      countryCode: { $local: 'countryCode' },
    },
    {
      perspective: 'adamStore.rootPerspective',
      parent: { model: 'AgentProfile', id: '$profile.id', field: 'location' },
    }
  ]
}
```

The `$query` subscription on `AgentProfile` (with `include: { location: true }`)
fires after the link write and delivers the updated profile — no explicit re-fetch or
sync needed, same as text field updates.

### After this task

- Remove `updateAgentLocation` from `AdamStore.tsx`
- Remove from the `AdamStore` interface type
- Update `Profile.schema.ts` location form's save action

---

## Summary of files changed across all tasks

| File                                                                                             | Tasks |
| ------------------------------------------------------------------------------------------------ | ----- |
| `packages/schema-system/shared/src/types.ts`                                                     | 1     |
| `packages/schema-system/shared/src/zodSchemas.ts`                                                | 1     |
| `packages/schema-system/shared/src/propResolvers/query.ts`                                       | 1     |
| `packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx`                                 | 1     |
| `packages/ai-context/src/fragments/schema-operators.ts`                                          | 1, 2  |
| `packages/ai-context/src/fragments/store-patterns.ts`                                            | 1, 2  |
| `packages/app-framework/src/frameworks/solid/types.ts`                                           | 2     |
| `packages/app-framework/src/frameworks/solid/providers/TemplateProvider.tsx`                     | 2     |
| `packages/app-framework/src/frameworks/solid/stores/AdamStore.tsx`                               | 4     |
| `packages/app-framework/src/frameworks/solid/stores/SpaceStore.tsx`                              | 3     |
| `packages/app-framework/src/shared/schemas/shell/Profile.schema.ts`                              | 2, 4  |
| `packages/app-framework/src/shared/schemas/shell/tests/SchemaTokens.schema.ts`                   | 1     |
| `packages/app-framework/src/shared/schemas/DefaultTemplate/SpaceSidebar.ts`                      | 3     |
| `packages/app-framework/src/shared/schemas/DefaultTemplate/routes/FluxRoute/ChannelList.ts`      | 1     |
| `packages/app-framework/src/shared/schemas/DefaultTemplate/routes/FluxRoute/ConversationList.ts` | 1     |
| `packages/app-framework/src/shared/schemas/DefaultTemplate/routes/GlobeRoute/index.ts`           | 3     |
