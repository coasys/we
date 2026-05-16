# PR Plan: Image Compression DRY Refactor

## Summary

Eliminate repeated image-compression boilerplate across `SpaceStore` and `AdamStore` by:

1. Extracting a `compressImageToFileData` utility into `@we/models`
2. Collapsing the near-identical avatar/cover functions within each store into a single parameterised public function — exposed directly on the store interface so templates can call it with `field` as an arg
3. Using `Space.update()` (the existing static CRUD method on `Ad4mModel`) instead of the manual findAll → mutate → save pattern in `SpaceStore`

The two stores are **not** unified with each other — `AdamStore` image updates carry agent-specific post-save logic (global sync + `findOne` re-fetch) that differs fundamentally from the space update, so merging them would add coupling for no real gain.

---

## Current State

### The repeated pattern (appears 6+ times across two stores)

```ts
const compressedBlob = await resizeImage(imageFile, 0.6);
const imageBase64 = await blobToDataURL(compressedBlob);
// then inline-construct { data_base64, name, file_type: 'image/png' } as FileData
```

Occurs in:

- `SpaceStore.updateSpaceAvatar`
- `SpaceStore.updateSpaceCoverImage`
- `SpaceStore.createAgentProfile` (avatar + coverImage branches)
- `AdamStore.updateAvatarImage`
- `AdamStore.updateCoverImage`

### The manual find-mutate-save pattern (in SpaceStore)

```ts
const [spaceModel] = await Space.findAll(currentPerspective, { where: { uuid: currentPerspective.uuid } });
if (!spaceModel) return;
spaceModel.avatar = { ... };
await spaceModel.save();
```

`Ad4mModel` already exposes `static update(perspective, id, data)` which does this internally — we're doing it by hand.

### Two nearly-identical public functions in each store

`SpaceStore`: `updateSpaceAvatar` / `updateSpaceCoverImage` differ only in field name and `FileData.name` string.

`AdamStore`: `updateAvatarImage` / `updateCoverImage` are the same, but also carry post-save logic (global perspective sync + `findOne` re-fetch to restore hydrated location) that is identical between them.

---

## Planned Changes

### 1. Add `compressImageToFileData` to `@we/models`

All three of `resizeImage`, `blobToDataURL`, and `FileData` already live in `@we/models`. The helper belongs there — it's a model-layer concern (transforming a browser `File` into a `FileData` value object), not an app-framework concern.

```ts
// packages/models/src/utils.ts (or wherever resizeImage/blobToDataURL are exported from)
export async function compressImageToFileData(file: File, name: string): Promise<FileData> {
  const blob = await resizeImage(file, 0.6);
  return { data_base64: await blobToDataURL(blob), name, file_type: 'image/png' } as FileData;
}
```

Export it from the `@we/models` index so all consumers get it from the same import they already have.

### 2. Collapse SpaceStore avatar/cover into `updateSpaceImage`

Replace the two public functions with a single public `updateSpaceImage` function. The `FileData` name is derived internally from the field, so templates don't need to know about it. The two old wrappers are deleted — schema actions updated to call `updateSpaceImage` directly.

```ts
// SpaceStore interface: updateSpaceImage replaces updateSpaceAvatar + updateSpaceCoverImage
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

Schema actions updated from:

```ts
{ $action: 'spaceStore.updateSpaceAvatar', args: ['$arg'] }
{ $action: 'spaceStore.updateSpaceCoverImage', args: ['$arg'] }
```

to:

```ts
{ $action: 'spaceStore.updateSpaceImage', args: ['avatar', '$arg'] }
{ $action: 'spaceStore.updateSpaceImage', args: ['coverImage', '$arg'] }
```

### 3. Collapse AdamStore avatar/cover into `updateProfileImage`

Same approach. The post-save global sync + `findOne` re-fetch is identical between the two existing functions, so it lives once in the shared body.

```ts
// AdamStore interface: updateProfileImage replaces updateAvatarImage + updateCoverImage
async function updateProfileImage(field: 'avatar' | 'coverImage', imageFile: File): Promise<void> {
  const profile = agentProfile();
  const rootP = rootPerspective();
  if (!profile || !rootP) return;
  const fileName = field === 'avatar' ? 'profile-image' : 'cover-image';
  profile[field] = await compressImageToFileData(imageFile, fileName);
  await profile.save();

  // Sync BEFORE re-fetching — profile[field] is still a FileData object at this point
  const globalP = globalPerspective();
  if (globalP) {
    syncAgentProfileToParent(profile, globalP).catch((err) =>
      console.error(`AdamStore: syncAgentProfileToGlobal (${field}) failed`, err),
    );
  }

  // Re-fetch to restore the hydrated location relation that save() clears
  const updated = await AgentProfile.findOne(rootP, { include: { location: true } });
  if (updated) setAgentProfile(updated);
}
```

Schema actions updated from:

```ts
{ $action: 'adamStore.updateAvatarImage', args: ['$arg'] }
{ $action: 'adamStore.updateCoverImage', args: ['$arg'] }
```

to:

```ts
{ $action: 'adamStore.updateProfileImage', args: ['avatar', '$arg'] }
{ $action: 'adamStore.updateProfileImage', args: ['coverImage', '$arg'] }
```

### 4. Simplify SpaceStore.createAgentProfile

The conditional avatar/coverImage blocks reduce from ~6 lines each to ~1:

```ts
const avatarData = avatar instanceof File ? await compressImageToFileData(avatar, 'agent-avatar') : undefined;
const coverImageData =
  coverImage instanceof File ? await compressImageToFileData(coverImage, 'agent-cover') : undefined;
```

---

## Why not unify across stores?

`AdamStore` image updates carry agent-specific post-save behaviour (global perspective sync + `findOne` re-fetch to restore a hydrated relation) that doesn't exist in `SpaceStore`. Merging them into a single cross-store helper would require callbacks or flags to accommodate the difference — more complexity than the duplication saves. `compressImageToFileData` is the right shared boundary.

---

## Files Changed

| File                                                                        | Change                                                                                                                                                   |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/models/src/utils.ts` (or equivalent)                              | Add + export `compressImageToFileData`                                                                                                                   |
| `packages/models/src/index.ts`                                              | Re-export `compressImageToFileData`                                                                                                                      |
| `packages/app-framework/src/frameworks/solid/stores/SpaceStore.tsx`         | Replace `updateSpaceAvatar`/`updateSpaceCoverImage` with `updateSpaceImage`; use `Space.update()`; use `compressImageToFileData` in `createAgentProfile` |
| `packages/app-framework/src/frameworks/solid/stores/AdamStore.tsx`          | Replace `updateAvatarImage`/`updateCoverImage` with `updateProfileImage`; use `compressImageToFileData`                                                  |
| `packages/app-framework/src/shared/schemas/DefaultTemplate/SpaceSidebar.ts` | Update `$action` references to `updateSpaceImage`                                                                                                        |
| `packages/app-framework/src/shared/schemas/shell/Profile.schema.ts`         | Update `$action` references to `updateProfileImage`                                                                                                      |

---

## Out of Scope

- No other refactoring in either store.
