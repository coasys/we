# PR: File/Image Upload Support in Schema Local State

## Problem

`$localState` only supports `string | boolean | number` types. The `we-file-upload` primitive exists and emits `change` events with `File[]`, but there's no way to capture file objects in local schema state. The `/new-space` route needs a thumbnail upload — `adamStore.createSpace` already accepts an optional 4th arg `imageFile?: File`, but the schema can't wire it up.

## Scope

Add `'file'` as a new `LocalStateField` type so schemas can declare file state, bind `we-file-upload` to it via `$setLocal`, preview selected images, and pass `File` objects through to store actions.

---

## Changes

### 1. Extend `LocalStateField` type — `schema-system/shared/src/types.ts`

```ts
// Before
export type LocalStateField = {
  type: 'string' | 'boolean' | 'number';
  initial: string | boolean | number;
  validate?: ValidationRule[];
};

// After
export type LocalStateField = {
  type: 'string' | 'boolean' | 'number' | 'file';
  initial: string | boolean | number | null;
  validate?: ValidationRule[];
};
```

- `type: 'file'` — stores a `File | null` at runtime
- `initial: null` — files always start as null (no pre-populated file)

### 2. Update Zod schema — `schema-system/shared/src/zodSchemas.ts`

```ts
// Before
const zLocalStateField = z.object({
  type: z.enum(['string', 'boolean', 'number']),
  initial: z.union([z.string(), z.boolean(), z.number()]),
  validate: z.array(zValidationRule).optional(),
});

// After
const zLocalStateField = z.object({
  type: z.enum(['string', 'boolean', 'number', 'file']),
  initial: z.union([z.string(), z.boolean(), z.number(), z.null()]),
  validate: z.array(zValidationRule).optional(),
});
```

### 3. Schema renderer — handle `null` initial value

`schema-system/frameworks/solid/src/SchemaRenderer.tsx` — `createSignal(field.initial)` already works for `null`. No change needed unless validation logic breaks on null. Verify that the `validateField` function handles `null` gracefully (it should — `required` rule checks for falsy).

### 4. `$setLocal` resolver — file extraction

The `$setLocal` resolver uses `extractFromPath(event, value.from)` to pull values out of events. `we-file-upload` emits `change` with `detail: File[]`.

For a single-file upload, the schema would use:
```json
{ "$setLocal": "thumbnail", "from": "$event.detail.0" }
```
This extracts `event.detail[0]` (the first File). Verify `extractFromPath` handles numeric path segments for array indexing. If not, add support.

### 5. Add `$localPreview` token (new) — generate object URLs for image preview

To show a preview of the selected file, we need a reactive URL derived from the File state. Options:

**Option A — New `$localPreview` token:**
```ts
{ $localPreview: 'thumbnail' }
// Resolves to: URL.createObjectURL(file) or '' if null
```
Add in `propResolvers/local.ts`. Creates/revokes object URLs reactively.

**Option B — Use `$derived` (if it exists) or a computed pattern:**
Schemas could express this as a derived value. But `$derived` doesn't exist yet, so Option A is simpler for now.

**Recommendation:** Option A — simple, single-purpose, easy to clean up later if `$derived` is added.

### 6. Update WeTemplate `/new-space` route

Add thumbnail field to `$localState` and wire up `we-file-upload` + preview:

```ts
$localState: {
  name: { type: 'string', initial: '', validate: [{ rule: 'required', message: 'Name is required' }] },
  description: { type: 'string', initial: '' },
  shared: { type: 'boolean', initial: false },
  thumbnail: { type: 'file', initial: null },
},
```

Add a thumbnail upload section to the form children:
```ts
{
  type: 'we-form-field',
  props: { label: 'Thumbnail' },
  children: [
    {
      type: 'we-file-upload',
      props: {
        accept: 'image/*',
        onChange: { $setLocal: 'thumbnail', from: '$event.detail.0' },
      },
    },
  ],
},
// Image preview (only shown when file selected)
{
  type: 'we-image',
  props: {
    src: { $localPreview: 'thumbnail' },
    width: '100%',
    maxWidth: '200px',
    r: '400',
    display: { $if: { condition: { $local: 'thumbnail' }, then: 'block', else: 'none' } },
  },
},
```

Update the create action to pass the file:
```ts
{
  $action: 'adamStore.createSpace',
  args: [
    { $local: 'name' },
    { $local: 'description' },
    { $local: 'shared' },
    { $local: 'thumbnail' },
  ],
}
```

### 7. Tests

- **types/zod:** Validate `{ type: 'file', initial: null }` passes structural validation
- **types/zod:** Validate `{ type: 'file', initial: 'bad' }` fails (or decide if we allow any initial for file)
- **$setLocal resolver**: Test that `extractFromPath` handles `$event.detail.0` array indexing
- **$localPreview resolver**: Test object URL creation and null handling
- **Semantic validation**: Ensure `file` type doesn't break semantic checks

---

## File Inventory

| File | Change |
|------|--------|
| `packages/schema-system/shared/src/types.ts` | Add `'file'` to LocalStateField type union |
| `packages/schema-system/shared/src/zodSchemas.ts` | Add `'file'` to enum, `z.null()` to initial |
| `packages/schema-system/shared/src/propResolvers/local.ts` | Add `resolveLocalPreviewProp` function |
| `packages/schema-system/shared/src/propResolvers/index.ts` | Export new resolver |
| `packages/schema-system/shared/src/resolveProps.ts` | Handle `$localPreview` token |
| `packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx` | Verify null initial works, possibly manage objectURL lifecycle |
| `packages/app-framework/src/shared/schemas/WeTemplate.schema.ts` | Add thumbnail to `/new-space` route |
| `packages/schema-system/shared/tests/` | New/updated tests for file type |

## Open Questions

1. **`extractFromPath` array indexing** — does `'$event.detail.0'` work for array access? If not, need to add numeric segment handling.
2. **Object URL cleanup** — `$localPreview` creates `URL.createObjectURL()`. Need to `revokeObjectURL()` on cleanup. The SchemaRenderer already has `onCleanup` support via Solid — use it.
3. **Validation rules for files** — should `required` work for file fields (check `!= null`)? Should we add `maxSize` / `acceptType` rules later?
4. **Multiple files** — this PR covers single file (`File | null`). A future `'files'` type could handle `File[]` if needed.
