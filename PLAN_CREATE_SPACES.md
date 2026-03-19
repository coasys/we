# Plan: Space Creation Route

## Goal
Allow users to create new spaces from a dedicated `/new-space` route. Spaces map to AD4M perspectives (personal) or neighbourhoods (shared). Created spaces appear in the sidebar dynamically from the store.

## Current State
- **Space model** exists (`@we/models` - Space.ts) with `name`, `description`, `visibility`, `locations`
- **CreateSpaceModalWidget** exists in `@we/widgets` — creates a perspective + Space instance but has no personal/shared toggle and no neighbourhood support
- **AdamStore** has `mySpaces` signal and `addNewSpace()` method; loads spaces on init via `getMySpaces()`
- **ModalStore** has `createSpaceModalOpen` signal
- **weNativeApp.ts** sidebar has a "New space" item that navigates to `/new-space`, but **no route is defined** for it
- Sidebar has hardcoded "Spaces" group with dummy Design Team / Dev Team entries

---

## Phase 1: Basic Space Creation

### 1. Create `CreateSpacePage` component
**File:** `packages/design-system/5-widgets/src/widgets/pages/CreateSpacePage/CreateSpacePage.solid.tsx` (new)

A SolidJS component (not schema-driven) that owns its own ephemeral form state. This follows the same pattern as `BlockComposer` on the `/new-post` route — a registered component referenced from schema.

Contains:
- Title "New space"
- `we-input` for name
- `we-input` for description
- Toggle to choose "Personal" (perspective) vs "Shared" (neighbourhood)
- "Create" button
- Local signals: `name`, `description`, `shared`, `loading`
- On submit: calls `adamStore.createSpace(name, description, shared)`

Why a component instead of schema: ephemeral form state (name, description, loading) doesn't belong in a global store. See `PLAN_SCOPED_LOCAL_STATE.md` for the future schema-native solution.

### 2. Register `CreateSpacePage` in component registry
**File:** `packages/app-framework/src/frameworks/solid/registries/componentRegistry.tsx`

Add `'CreateSpacePage': CreateSpacePage` so schema can reference it as `{ type: 'CreateSpacePage' }`.

### 3. Add `/new-space` route to weNativeApp.ts
**File:** `packages/app-framework/src/shared/schemas/weNativeApp.ts`

```json
{
  "path": "/new-space",
  "type": "Column",
  "props": { "ax": "center", "width": "100%", "height": "100%", "position": "relative" },
  "children": [
    { "type": "CreateSpacePage", "props": {} }
  ]
}
```

### 4. Add `createSpace` action to AdamStore
**File:** `packages/app-framework/src/frameworks/solid/stores/AdamStore.tsx`

New method `createSpace(name: string, description: string, shared: boolean)`:
1. Create perspective: `client.perspective.add(name)`
2. Register SDNA models: `ensureSDNASubjectClass(Space)`, `ensureSDNASubjectClass(WeNode)`, plus block models
3. Wait 500ms (existing SDNA timing hack)
4. If shared: get link language template via `client.runtime.knownLinkLanguageTemplates()`, apply + publish as neighbourhood via `client.languages.applyTemplateAndPublish()` then `client.neighbourhood.publishFromPerspective()`
5. Create + save Space model with name, description, visibility
6. Call `addNewSpace(space)` to update sidebar
7. Navigate to `/space/{uuid}`

### 5. Replace hardcoded sidebar spaces with dynamic `$forEach`
**File:** `packages/app-framework/src/shared/schemas/weNativeApp.ts`

Replace the hardcoded "Spaces" group (Design Team, Dev Team) with a `$forEach` that iterates over `adamStore.mySpaces` and renders a sidebar item per space. Each item navigates to `/space/{uuid}`.

### Phase 1 File Changes

| File | Change |
|------|--------|
| `packages/design-system/5-widgets/src/widgets/pages/CreateSpacePage/CreateSpacePage.solid.tsx` | New component with form |
| `packages/app-framework/src/frameworks/solid/registries/componentRegistry.tsx` | Register CreateSpacePage |
| `packages/app-framework/src/frameworks/solid/stores/AdamStore.tsx` | Add `createSpace` action + expose in interface |
| `packages/app-framework/src/shared/schemas/weNativeApp.ts` | Add `/new-space` route; dynamic sidebar spaces |

---

## Phase 2: Space Image Upload (follow-up)

Add image/thumbnail support to spaces, following the Flux file storage language pattern.

### How Flux handles images
Flux uses AD4M's **file storage language** (`QmzSYwdjqeP9D13Sfmyc5HcabM9jL3DtPyhadnF6dQXu4FjVSbQ`) as an expression language for binary data. The flow:

1. **User selects image** → raw File/Blob from `<input>` or drag-and-drop
2. **Resize** to two versions using canvas:
   - Thumbnail: 30% size (`resizeImage(blob, 0.3)`)
   - Full image: 60% size (`resizeImage(blob, 0.6)`)
3. **Convert to base64** via `blobToDataURL()` → returns base64 string
4. **Pass as `FileData` to model**: `{ data_base64: string, name: string, file_type: 'image/png' }`
5. **AD4M model property** uses `resolveLanguage: FILE_STORAGE_LANGUAGE` and a `transform` to auto-resolve stored expressions back to data URIs when reading:
   ```ts
   @Property({
     through: 'we://has_image',
     resolveLanguage: FILE_STORAGE_LANGUAGE,
     transform: (data) =>
       data?.data_base64 ? `data:${data?.file_type || 'image/png'};base64,${data?.data_base64}` : data,
   })
   image: string | FileData;
   ```

### Changes needed

#### 2a. Add image utilities to `@we/models` or a new `@we/utils` package
Port the three helpers from Flux:
- `dataURItoBlob(dataURI: string): Blob`
- `blobToDataURL(blob: Blob): Promise<string>`
- `resizeImage(file: Blob, percentage: number, maxSize?: number): Promise<Blob>`

These are pure browser utils — no dependencies.

#### 2b. Add `image` and `thumbnail` properties to Space model
**File:** `packages/models/src/entities/Space.ts`

```ts
const FILE_STORAGE_LANGUAGE = 'QmzSYwdjqeP9D13Sfmyc5HcabM9jL3DtPyhadnF6dQXu4FjVSbQ';

@Property({
  through: 'we://has_image',
  resolveLanguage: FILE_STORAGE_LANGUAGE,
  transform: (data) =>
    data?.data_base64 ? `data:${data?.file_type || 'image/png'};base64,${data?.data_base64}` : data,
})
image: string | FileData;

@Property({
  through: 'we://has_thumbnail',
  resolveLanguage: FILE_STORAGE_LANGUAGE,
  transform: (data) =>
    data?.data_base64 ? `data:${data?.file_type || 'image/png'};base64,${data?.data_base64}` : data,
})
thumbnail: string | FileData;
```

#### 2c. Add image picker to `CreateSpacePage`
- File input / drop zone for image selection
- Preview with remove button
- On submit: resize → convert to base64 → pass as `FileData` to `createSpace`

#### 2d. Update `createSpace` to handle images
```ts
// In createSpace, after creating space instance:
if (imageFile) {
  const thumbnail = await blobToDataURL(await resizeImage(imageFile, 0.3));
  const compressed = await blobToDataURL(await resizeImage(imageFile, 0.6));
  space.thumbnail = { data_base64: thumbnail, name: 'space-image', file_type: 'image/png' };
  space.image = { data_base64: compressed, name: 'space-image', file_type: 'image/png' };
}
await space.save();
```

#### 2e. Display space images in sidebar
Update the `$forEach` sidebar items to show space thumbnails as avatars.

### Phase 2 File Changes

| File | Change |
|------|--------|
| `packages/models/src/utils/imageHelpers.ts` | New — port resize/convert utils from Flux |
| `packages/models/src/entities/Space.ts` | Add `image` + `thumbnail` properties with `resolveLanguage` |
| `packages/design-system/5-widgets/src/widgets/pages/CreateSpacePage/CreateSpacePage.solid.tsx` | Add image picker + preview |
| `packages/app-framework/src/frameworks/solid/stores/AdamStore.tsx` | Update `createSpace` to handle image resize + save |
| `packages/app-framework/src/shared/schemas/weNativeApp.ts` | Sidebar items show space thumbnail |

---

## Out of Scope
- Link language template selection UI for neighbourhoods (auto-picks first available)
- Notification setup
- Space deletion/editing
- Space settings page
