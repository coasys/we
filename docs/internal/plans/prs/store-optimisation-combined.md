# PR Plan: Store Optimisation + Template-Driven Profile

## Replaces

The two earlier draft plans (`image-compression-dry-refactor.md` and
`agentprofile-query-subscription-refactor.md`) are superseded by this document.
The changes are shipped as a single coherent PR — they are sequentially dependent
and the intermediate state is not useful on its own.

---

## Goals

1. Eliminate repeated image-compression boilerplate.
2. Remove all per-mutation sync + re-fetch boilerplate from `AdamStore` by making
   `agentProfile` subscription-driven and letting the subscription own the global sync.
3. Push profile text-field mutations out of the store entirely — templates call
   `model.update` directly.
4. Rationalise `SpaceStore` image functions using the same patterns.
5. Update `Profile.schema.ts` to use `$query` for live display, `model.update` for
   text edits, and the slimmed store action for image uploads.

---

## Key Insight: `FILE_STORAGE_LANGUAGE` is content-addressed

`FILE_STORAGE_LANGUAGE` (`QmzSYwddqhm49PrRMzSrJf3AvmmreXMKtr1u56nbTjBFVmCzS8N`) derives
each file address as `hash(JSON.stringify({name, size, file_type, data_base64}))`. The
server explicitly handles duplicate uploads with "reusing existing upload". Same bytes +
same `name`/`file_type` metadata always resolves to the same address.

After `AgentProfile.findOne()` the `resolveLanguage` transform converts a stored
`FileData` object to a `data:image/png;base64,...` string. That string can be mechanically
reversed back into the original `FileData`:

```ts
function dataURIToFileData(dataUri: string, name: string): FileData {
  const [header, data_base64] = dataUri.split(',');
  const file_type = header.split(';')[0].split(':')[1];
  return { data_base64, name, file_type };
}
```

Passing this reconstructed `FileData` to `createExpression(FILE_STORAGE_LANGUAGE)` is
safe — the server deduplicates and returns the same address without creating a new file.

This eliminates the ordering constraint that previously forced image sync to happen
before any `findOne` call could run, because by then the value would have been
transformed to a URL string. The subscription callback now receives a fully-hydrated
instance (with `location`, with URL strings for images) and can sync reliably for all
field types.

---

## Part 1 — New utilities in `@we/models`

### `compressImageToFileData`

Consolidates the 6+ identical compress-then-wrap blocks scattered across both stores.

```ts
// packages/models/src/utils/imageHelpers.ts
export async function compressImageToFileData(file: File, name: string): Promise<FileData> {
  const blob = await resizeImage(file, 0.6);
  return { data_base64: await blobToDataURL(blob), name, file_type: 'image/png' };
}
```

### `dataURIToFileData`

Reconstructs the original `FileData` value object from a resolved data URI string.
Safe to pass back through `FILE_STORAGE_LANGUAGE` because the storage is
content-addressed and deduplicates automatically.

```ts
// packages/models/src/utils/imageHelpers.ts
export function dataURIToFileData(dataUri: string, name: string): FileData {
  const [header, data_base64] = dataUri.split(',');
  const file_type = header.split(';')[0].split(':')[1]; // e.g. 'image/png'
  return { data_base64, name, file_type };
}
```

Both are re-exported from `packages/models/src/index.ts`.

---

## Part 2 — Update `syncAgentProfileToParent`

Remove the `typeof !== 'string'` guards on image fields. Replace with reconstruction:

```ts
// packages/app-framework/src/shared/syncHelpers.ts

// Before:
if (profile.avatar && typeof profile.avatar !== 'string') existing.avatar = profile.avatar;
if (profile.coverImage && typeof profile.coverImage !== 'string') existing.coverImage = profile.coverImage;

// After:
if (profile.avatar)
  existing.avatar =
    typeof profile.avatar === 'string' ? dataURIToFileData(profile.avatar, 'profile-image') : profile.avatar;
if (profile.coverImage)
  existing.coverImage =
    typeof profile.coverImage === 'string' ? dataURIToFileData(profile.coverImage, 'cover-image') : profile.coverImage;
```

Same change in the `AgentProfile.create` branch (for the first-sync / no-existing path).

This makes `syncAgentProfileToParent` correct regardless of when it is called relative
to `findOne` — image values in either form are handled safely.

---

## Part 3 — `AdamStore` refactor

### 3a. Replace one-shot `AgentProfile.findOne` with a subscription

In `initSystemPerspectives`, after `setRootPerspective(existing)`, replace the one-shot
`AgentProfile.findOne` with a live query that drives `agentProfile` and owns the global
sync:

```ts
const profileBuilder = AgentProfile.query(rootP, { include: { location: true } });
const profileSub = profileBuilder.subscribe((profiles) => {
  const profile = profiles[0];
  if (!profile) return;
  setAgentProfile(profile);
  const globalP = globalPerspective();
  if (globalP) {
    syncAgentProfileToParent(profile, globalP).catch((err) =>
      console.error('AdamStore: subscription sync agentProfile to global failed', err),
    );
  }
});
onCleanup(() => profileSub.dispose());
```

The subscription fires:

- On initial load (replaces `AgentProfile.findOne`)
- After any `model.update` call touching `AgentProfile` (text field edits from templates)
- After `updateProfileImage` saves the profile (image updates)
- After `updateAgentLocation` creates and links a new `LocationBlock`

The subscription callback handles sync for **all** mutation types. No individual mutation
function needs to call `syncAgentProfileToParent` or re-fetch afterwards.

The `agentProfile` signal is kept — it is still read by `joinSpace` on join and by the
store interface type. It is now subscription-driven rather than manually managed.

### 3b. Remove `updateAgentProfile`

Text-field updates (`firstName`, `lastName`, `handle`, `bio`) are now handled in
templates via `model.update`. The subscription fires after the link-write lands and
syncs to global automatically.

Function deleted; removed from the store interface type.

### 3c. Remove `updateAvatarImage` and `updateCoverImage`

Replaced by the single `updateProfileImage` below.

### 3d. Add `updateProfileImage`

The only profile-image concern left in the store is the compression step — the
subscription handles sync. Since `agentProfile()` is now subscription-driven and always
fresh, the profile ID can be read directly from the signal and `AgentProfile.update()`
used as a clean static call — consistent with how `SpaceStore` handles `Space.update()`.

```ts
async function updateProfileImage(field: 'avatar' | 'coverImage', imageFile: File): Promise<void> {
  const rootP = rootPerspective();
  const profile = agentProfile();
  if (!rootP || !profile) return;
  await AgentProfile.update(rootP, profile.id, {
    [field]: await compressImageToFileData(imageFile, field === 'avatar' ? 'profile-image' : 'cover-image'),
  });
  // Subscription fires after the link-write and handles setAgentProfile + sync
}
```

### 3e. `updateAgentLocation` — unchanged except drop explicit sync

`LocationBlock.create` + `setLocation` relation cannot be expressed in a `model.update`
call, so this function stays. The `setAgentProfile(updated)` call and the explicit
`syncAgentProfileToParent` call are removed — the link change triggers the subscription,
which handles both.

```ts
async function updateAgentLocation(latitude, longitude, city?, country?, countryCode?): Promise<void> {
  const rootP = rootPerspective();
  const profile = agentProfile();
  if (!rootP || !profile) return;
  const name = city && country ? `${city}, ${country}` : (city ?? country ?? undefined);
  const loc = await LocationBlock.create(rootP, {
    latitude,
    longitude,
    ...(name && { name }),
    ...(city && { city }),
    ...(country && { country }),
    ...(countryCode && { countryCode }),
  });
  await (profile as unknown as { setLocation: (v: LocationBlock) => Promise<void> }).setLocation(loc);
  // Subscription fires on the LocationBlock link change and handles sync
}
```

### 3f. `initSystemPerspectives` — first-boot path

The new-root creation branch also uses `AgentProfile.create(perspective, {})` but sets up
the subscription immediately after rather than storing the result directly in the signal.
The subscription's initial fire delivers the first value.

### 3g. `joinSpace` — read profile from signal at call time (unchanged logic)

`joinSpace` reads `agentProfile()` to sync on joining the global space. Since the signal
is now subscription-driven it is always fresh — no change needed to the logic.

### 3h. Boot sync on existing global perspective

In `initSystemPerspectives`, after `setGlobalPerspective(existingGlobal)`, the existing
`syncAgentProfileToParent(currentProfile, existingGlobal)` boot-time call is kept.
The profile value at that point is whatever the subscription last delivered (or the
initial resolved value). This is a belt-and-suspenders sync on app start.

### Store interface changes

| Removed              | Added                |
| -------------------- | -------------------- |
| `updateAgentProfile` | `updateProfileImage` |
| `updateAvatarImage`  |                      |
| `updateCoverImage`   |                      |

`agentProfile` accessor remains; all other accessors and actions are unchanged.

---

## Part 4 — `SpaceStore` refactor

### 4a. Replace `updateSpaceAvatar` + `updateSpaceCoverImage` with `updateSpaceImage`

```ts
async function updateSpaceImage(field: 'avatar' | 'coverImage', imageFile: File): Promise<void> {
  const currentSpace = space();
  const currentPerspective = adamStore.currentPerspective();
  if (!currentSpace || !currentPerspective) return;
  const fileName = field === 'avatar' ? 'space-image' : 'space-cover';
  const updated = await Space.update(currentPerspective, currentPerspective.uuid, {
    [field]: await compressImageToFileData(imageFile, fileName),
  });
  setSpace({ ...currentSpace, [field]: updated[field] });
}
```

Uses `Space.update()` (the existing static CRUD method on `Ad4mModel`) instead of the
manual `findAll → mutate → save` pattern.

### 4b. Simplify `createAgentProfile`

The conditional avatar/coverImage compress blocks reduce from ~6 lines each to one:

```ts
const avatarData = avatar instanceof File ? await compressImageToFileData(avatar, 'agent-avatar') : undefined;
const coverImageData =
  coverImage instanceof File ? await compressImageToFileData(coverImage, 'agent-cover') : undefined;
```

### SpaceStore interface changes

| Removed                 | Added              |
| ----------------------- | ------------------ |
| `updateSpaceAvatar`     | `updateSpaceImage` |
| `updateSpaceCoverImage` |                    |

---

## Part 5 — `Profile.schema.ts` update

Replace all `$store: 'adamStore.agentProfile.*'` display tokens with a `$query`
subscription that owns its own live data. Replace `$action: 'adamStore.updateAgentProfile'`
and the image actions with `model.update` and `adamStore.updateProfileImage` respectively.

### Display: `$query` + `$each`

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
    // All display nodes — replace $store tokens:
    // { $store: 'adamStore.agentProfile.firstName' } → '$profile.firstName'
    // { $store: 'adamStore.agentProfile.location.latitude' } → '$profile.location.latitude'
    // etc.
  ],
}
```

The `$query` token defaults to `subscribe: true`, so the displayed data is always live.
`include: { location: true }` re-hydrates location on every subscription update,
replacing the manual re-fetch that `save()` previously cleared.

### Text field mutations: `model.update`

```ts
// Before:
{ $action: 'adamStore.updateAgentProfile', args: [{ firstName: '$arg.detail' }] }

// After:
{ $action: 'model.update', args: ['AgentProfile', '$profile.id', { firstName: '$arg.detail' }] }
```

Applied to all `we-input` / `we-textarea` `onChange` handlers in the profile form.

### Image mutations: `adamStore.updateProfileImage`

```ts
// Before:
{ $action: 'adamStore.updateAvatarImage', args: ['$arg'] }
{ $action: 'adamStore.updateCoverImage', args: ['$arg'] }

// After:
{ $action: 'adamStore.updateProfileImage', args: ['avatar', '$arg'] }
{ $action: 'adamStore.updateProfileImage', args: ['coverImage', '$arg'] }
```

---

## Part 6 — `SpaceSidebar.ts` update

```ts
// Before:
{ $action: 'spaceStore.updateSpaceAvatar', args: ['$arg'] }
{ $action: 'spaceStore.updateSpaceCoverImage', args: ['$arg'] }

// After:
{ $action: 'spaceStore.updateSpaceImage', args: ['avatar', '$arg'] }
{ $action: 'spaceStore.updateSpaceImage', args: ['coverImage', '$arg'] }
```

---

## Files Changed

| File                                                                        | Change                                                                                                                                                             |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/models/src/utils/imageHelpers.ts`                                 | Add `compressImageToFileData`, `dataURIToFileData`                                                                                                                 |
| `packages/models/src/index.ts`                                              | Re-export both new utilities                                                                                                                                       |
| `packages/app-framework/src/shared/syncHelpers.ts`                          | Update image field handling in `syncAgentProfileToParent` to use `dataURIToFileData`                                                                               |
| `packages/app-framework/src/frameworks/solid/stores/AdamStore.tsx`          | Subscription-driven `agentProfile`; remove `updateAgentProfile`, `updateAvatarImage`, `updateCoverImage`; add `updateProfileImage`; simplify `updateAgentLocation` |
| `packages/app-framework/src/frameworks/solid/stores/SpaceStore.tsx`         | Replace `updateSpaceAvatar`/`updateSpaceCoverImage` with `updateSpaceImage`; use `Space.update()`; simplify `createAgentProfile`                                   |
| `packages/app-framework/src/shared/schemas/shell/Profile.schema.ts`         | `$query` display; `model.update` for text fields; `updateProfileImage` for images                                                                                  |
| `packages/app-framework/src/shared/schemas/DefaultTemplate/SpaceSidebar.ts` | Update `$action` references to `updateSpaceImage`                                                                                                                  |

---

## Follow-up work (out of scope for this PR)

### Perspective-aware `modelStore`

The `model` store in `TemplateProvider` is currently hardwired to
`adamStore.currentPerspective()`. Two approaches would unlock template-driven mutations
on root-perspective models (e.g. `AgentProfile`, `LocationBlock`):

1. **`rootModel` store** — a second store object wired to `adamStore.rootPerspective()`,
   passed into the `Stores` object alongside `model`. Templates would call
   `rootModel.create(...)` / `rootModel.update(...)` for root-scoped writes.

2. **Perspective argument on `model` methods** — extend the `model` store API so callers
   can pass an explicit perspective reference:
   `model.create('LocationBlock', data, { perspective: 'adamStore.rootPerspective', ... })`

Either approach would allow `updateAgentLocation` (and any future root-perspective
relation mutations) to be fully template-driven, making the `$if` / conditional
create-vs-update pattern viable without store involvement.

---

## What stays intentionally unchanged

- **`agentSettings` signal** — read reactively by `TemplateStore` and `ThemeStore` inside
  `createEffect`s for boot-critical logic (template selection, theme restoration). It
  drives TypeScript control flow, not template display. Moving it to a subscription adds
  no value and risks breaking boot sequencing.
- **`space` signal in `SpaceStore`** — the store exists for `signalTypes`,
  `signalTypesBySlug`, and the `isWeSpace` orchestration. The `space` signal is a small
  part; removing it saves minimal code.
- **`updateAgentLocation`** — cannot be expressed as `model.update`; requires
  `LocationBlock.create` and the `setLocation` relation method.

---

## Net effect on AdamStore

| Before                                                             | After                                                 |
| ------------------------------------------------------------------ | ----------------------------------------------------- |
| `agentProfile` signal set manually in 5–6 places                   | Signal driven by single subscription                  |
| Re-fetch boilerplate in 3 mutation functions                       | No re-fetch anywhere                                  |
| Explicit `syncAgentProfileToParent` in 3 mutation functions + boot | Single sync site in subscription callback + boot      |
| 3 separate image/text profile mutation functions                   | 1 (`updateProfileImage`), text goes to `model.update` |
| `findOne` ordering constraint for image sync                       | Eliminated — `dataURIToFileData` reconstruction       |
