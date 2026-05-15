# PR Plan: AgentProfile $query Subscription Refactor

## Summary

Remove `agentProfile` as a stored signal from `AdamStore` and replace it with a `$query` subscription directly in the `Profile` schema. The `$query` token already defaults to a live subscription via `ModelQueryBuilder.subscribe()`, so the profile data becomes self-maintaining — no explicit re-fetches needed after mutations.

`agentSettings` and `space` (SpaceStore) are intentionally **not** touched — see the "Out of Scope" section for reasoning.

---

## Current State

### The re-fetch pattern (appears 3 times in AdamStore)

Every mutation function that touches `AgentProfile` ends with the same boilerplate:

```ts
const updated = await AgentProfile.findOne(rootP, { include: { location: true } });
if (updated) setAgentProfile(updated);
```

This exists because `profile.save()` clears the hydrated `location` relation, so the in-memory instance is stale after saving. The store works around it by re-fetching. The functions are:

- `updateAgentProfile` — re-fetches after `Object.assign` + `save()`
- `updateAvatarImage` — re-fetches after compressing + saving avatar
- `updateCoverImage` — re-fetches after compressing + saving cover image

### The signal in AdamStore

```ts
const [agentProfile, setAgentProfile] = createSignal<AgentProfile | null>(null, { equals: false });
```

Set in three places:

1. `initSystemPerspectives` — initial load (both the existing-root and new-root branches)
2. `updateAgentLocation` — after creating + linking a new `LocationBlock`
3. The three mutation functions above

Exposed via the store interface as `agentProfile: Accessor<AgentProfile | null>`.

### The single consumer

`Profile.schema.ts` — the shell profile template. It reads `agentProfile` exclusively via `$store` tokens:

```ts
{
  $store: 'adamStore.agentProfile.firstName';
}
{
  $store: 'adamStore.agentProfile.avatar';
}
{
  $store: 'adamStore.agentProfile.location.latitude';
}
// etc.
```

No imperative TypeScript code outside the store reads `agentProfile()` — confirmed by codebase audit.

---

## Planned Changes

### 1. Remove `agentProfile` signal from AdamStore

Delete:

- `const [agentProfile, setAgentProfile] = createSignal(...)` declaration
- All `setAgentProfile(...)` calls
- `agentProfile` from the store interface type and the returned store object

The `{ equals: false }` option and the signal itself become unnecessary.

### 2. Simplify the three mutation functions

Each function no longer needs to re-fetch after saving. The `$query` subscription in the template will fire automatically when the link change lands.

**`updateAgentProfile`** — remove the `findOne` re-fetch entirely:

```ts
async function updateAgentProfile(updates: Partial<AgentProfile>): Promise<void> {
  const profile = await AgentProfile.findOne(rootPerspective());
  if (!profile || !rootPerspective()) return;
  Object.assign(profile, updates);
  await profile.save();
  // Sync to global perspective
  const globalP = globalPerspective();
  if (globalP) syncAgentProfileToParent(profile, globalP).catch(...);
}
```

**`updateAvatarImage`** and **`updateCoverImage`** — keep the sync-before-refetch ordering rule (the `syncAgentProfileToParent` must run while `FileData` is still on the instance, before any URL resolution), but drop the `setAgentProfile` call:

```ts
async function updateAvatarImage(imageFile: File): Promise<void> {
  const rootP = rootPerspective();
  if (!rootP) return;
  const profile = await AgentProfile.findOne(rootP);
  if (!profile) return;
  profile.avatar = await compressImageToFileData(imageFile, 'profile-image');
  await profile.save();
  // Sync BEFORE URL resolution — FileData object must still be in place
  const globalP = globalPerspective();
  if (globalP) syncAgentProfileToParent(profile, globalP).catch(...);
}
```

Note: these functions now do a `findOne` at call time rather than reading a cached signal. That's one extra round-trip per mutation, but it's correct and avoids any stale-data risk.

**`updateAgentLocation`** — currently calls `setAgentProfile(updated)` at the end. Remove that call. The `LocationBlock` link change triggers the `$query` subscription automatically.

### 3. Update `initSystemPerspectives`

Remove both `setAgentProfile(profile)` calls (one in the existing-root branch, one in the new-root branch). The initial `AgentProfile.findOne` can be kept as a one-time existence check (to create it if it doesn't exist on first boot), but the result no longer needs to be stored in a signal.

### 4. Update Profile.schema.ts to use `$query`

Replace all `$store: 'adamStore.agentProfile.*'` tokens with a `$query` that owns its own subscription:

```ts
{
  type: '$each',
  props: {
    items: {
      $query: {
        model: 'AgentProfile',
        perspectiveStore: 'adamStore.rootPerspective',
        include: { location: true },
      },
    },
    as: 'profile',
  },
  children: [
    // All existing children, with $store tokens replaced by $profile.*
    { type: 'we-text', children: ['$profile.firstName'] },
    { type: 'EditableImage', props: { src: '$profile.avatar' } },
    // etc.
  ],
}
```

The `$query` defaults to `subscribe: true`, so the subscription is live. The `include: { location: true }` re-hydrates location on every update, replacing the manual re-fetch that `save()` was previously clearing.

### 5. Sync ordering — explicit rule to preserve

`syncAgentProfileToParent` must still be called explicitly inside the mutation actions, immediately after `save()`, while the `FileData` object is still on the in-memory instance. It must **not** be triggered reactively from the schema subscription callback — by the time the subscription fires, the executor may have already resolved the file URL, and `FILE_STORAGE_LANGUAGE` needs the raw `FileData`.

This ordering is unchanged from today — it's just clarified and maintained rather than accidentally broken.

---

## Out of Scope

### `agentSettings` — stays in AdamStore

`TemplateStore` and `ThemeStore` both read `adamStore.agentSettings()` reactively inside `createEffect`s for boot-critical logic (template selection, theme restoration, perspective ordering). It's not a template display concern — it drives TypeScript control flow. Moving it to `$query` would just relocate the subscription into two other stores with no gain.

### `space` in SpaceStore — stays

The SpaceStore continues to exist for `signalTypes` + `signalTypesBySlug` and the `isWeSpace` orchestration. The `space` signal is a small part of that store and removing it saves minimal code while the store itself remains. `Sidebar.schema.ts` reads `spaceStore.space.avatar` in one conditional — not worth the churn.

---

## Impact

| Before                                                                                  | After                                                     |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `agentProfile` signal in AdamStore + 5–6 `setAgentProfile` call sites                   | Signal removed entirely                                   |
| Re-fetch boilerplate in 3 mutation functions                                            | No re-fetch; subscription handles UI update               |
| Profile.schema.ts reads `$store: 'adamStore.agentProfile.*'`                            | Profile.schema.ts owns its own `$query` subscription      |
| Location re-hydration done manually via `findOne(..., { include: { location: true } })` | Re-hydration done by `$query`'s `include` on every update |

The mutation action functions become smaller and more straightforward — they do one thing (mutate + sync) rather than three (mutate + sync + re-fetch + update signal).
