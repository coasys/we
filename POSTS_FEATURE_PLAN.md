# Posts Feature Plan

## Goal

Add a "Create Post" button to the space posts page that opens a modal with the BlockEditor (BlockComposer) for composing posts, then render saved posts in a list.

---

## Current State

- **Posts tab** exists in `DefaultTemplate.schema.ts` (line ~570) — renders a `$each` loop over `spaceStore.posts`
- **SpaceStore.getPosts()** fetches `CollectionBlock.findAll(perspective, { where: { type: 'root' } })` and recursively loads child blocks via `getBlockTree()`
- **Current post rendering** only shows `$post.text` and `$post.timestamp` — very basic, doesn't render the full block tree
- **BlockComposer** component exists at `packages/block-system/frameworks/solid/src/components/BlockComposer.tsx` — Lexical-based rich text editor with a built-in SaveButton that calls `createBlocks(perspective, root)`
- **BlockComposer is already registered** in the component registry as `'BlockComposer'`
- The BlockComposer currently takes `{ post?, perspective }` — it calls `createBlocks(perspective, root)` internally on save. This couples the editor to persistence. We want to decouple: BlockComposer becomes a pure editor that emits Lexical JSON via `onSave(json)`, and the SpaceStore handles parsing + saving.
- **$query token** resolves models via `getModel()` from `modelRegistry.ts` — currently only `TestItem` is registered (in `testStore.ts`)
- **`perspectiveStore` defaults** to `spaceStore.perspective` in the schema renderer, which is exactly the space's perspective

---

## Implementation Steps

### 1. Register block models in SpaceStore

**File:** `packages/app-framework/src/frameworks/solid/stores/SpaceStore.tsx`

Two registrations are needed — both belong in the SpaceStore since it owns the perspective:

1. **`registerModel(name, Class)`** (from `modelRegistry.ts`) — registers the JS class so `$query` can resolve the string `'CollectionBlock'` to its class. Call once at SpaceStore creation time (same pattern as `testStore.ts` calling `registerModel('TestItem', ...)`).

2. **`Model.register(perspective)`** — registers the SHACL schema on the AD4M perspective so the model can be queried. Call in `getSpace()` after obtaining the perspective (same pattern as `AdamStore.tsx` calling `CollectionBlock.register(spacePerspective)` during space creation).

```ts
import { registerModel } from '@shared/registries/modelRegistry';
import { CollectionBlock, TextBlock, ImageBlock } from '@we/models';

// At store creation — register JS classes for $query lookup
registerModel('CollectionBlock', CollectionBlock as any);
registerModel('TextBlock', TextBlock as any);
registerModel('ImageBlock', ImageBlock as any);
```

```ts
// In getSpace(), after obtaining the perspective — register SHACL on perspective
await Promise.all([
  CollectionBlock.register(spacePerspective),
  TextBlock.register(spacePerspective),
  ImageBlock.register(spacePerspective),
]);
await new Promise((r) => setTimeout(r, 500)); // Known delay needed after SHACL registration
```

**Note:** `AdamStore.tsx` already registers these models during space _creation_ (line ~334). The SpaceStore registration covers the case of _loading_ an existing space where the models may not have been registered on this client yet.

### 2. Replace `spaceStore.posts` with `$query` in the posts subroute

**File:** `packages/app-framework/src/shared/schemas/DefaultTemplate.schema.ts`

Replace the current `{ $store: 'spaceStore.posts' }` with a direct `$query`:

```ts
items: {
  $query: {
    model: 'CollectionBlock',
    subscribe: true,
    where: { type: 'root' }
  }
}
```

Since `perspectiveStore` defaults to `spaceStore.perspective` in the schema renderer, we don't even need to specify it. This gives us live-updating posts — when a new post is created via BlockComposer and saved, it will automatically appear in the list without needing a manual refresh.

**Note:** This returns flat `CollectionBlock` models (not recursively-loaded block trees). Each result will have properties like `display`, `direction`, `type`, and a `children` array of URIs. For rendering, we'll access `$post.display` or `$post.text` etc. If we need full tree rendering, we'll use the `BlockRenderer` component for each post.

### 3. Refactor BlockComposer into a pure editor (no persistence)

**Files:** `packages/block-system/shared/src/types.ts` + `packages/block-system/frameworks/solid/src/components/BlockComposer.tsx`

Currently BlockComposer calls `createBlocks(perspective, root)` internally. Refactor so it:

- **Removes** the `perspective` prop — no longer needed
- **Changes** `onSave` from `() => void` to `(json: SerializedBlockNode) => void`
- **SaveButton** extracts the Lexical JSON and calls `props.onSave?.(root)` instead of persisting directly
- The component becomes a pure, reusable editor that emits structured data

```ts
// New BlockComposerProps
export type BlockComposerProps = {
  post?: SerializedBlockNode; // Optional existing post to load into editor
  onSave?: (json: SerializedBlockNode) => void; // Emits serialized Lexical JSON
};
```

```ts
// New SaveButton — no persistence, just emits data
function SaveButton({ onSave }: { onSave?: (json: SerializedBlockNode) => void }) {
  const [editor] = useLexicalComposerContext();
  function save() {
    editor.update(() => {
      const { root } = editor.getEditorState().toJSON();
      onSave?.(root);
    });
  }
  return (
    <Row ax="end">
      <we-button onClick={save}><we-icon name="floppy-disk" /></we-button>
    </Row>
  );
}
```

### 4. Add `createPost` action to SpaceStore

**File:** `packages/app-framework/src/frameworks/solid/stores/SpaceStore.tsx`

Add a `createPost(json)` method that handles the actual persistence:

```ts
import { createBlocks } from '@we/block-shared';

async function createPost(json: unknown): Promise<void> {
  const p = perspective();
  if (!p) return;
  await createBlocks(p, json);
}
```

Expose on the store interface and return object so it's callable via `$action: 'spaceStore.createPost'`.

Since we're using `$query` with `subscribe: true`, the new post will appear in the list automatically after `createBlocks` commits.

### 5. Add "Create Post" button + modal to the posts subroute

**File:** `packages/app-framework/src/shared/schemas/DefaultTemplate.schema.ts`

In the `/posts` subroute, add:

- A `$localState` with `createPostOpen: { type: 'boolean', initial: false }`
- A "Create Post" `we-button` at the top that sets `createPostOpen` to `true`
- A `$if` block that renders `we-modal` when `createPostOpen` is `true`
- Inside the modal: `BlockComposer` with `onSave` wired to save + close:

```ts
{
  type: 'BlockComposer',
  props: {
    onSave: [
      { $action: 'spaceStore.createPost', args: ['$arg'] },
      { $setLocal: 'createPostOpen', value: false }
    ]
  }
}
```

`$arg` resolves to the Lexical JSON that BlockComposer passes to its `onSave` callback. The handler array saves the post then closes the modal.

**Pattern** — follows the `$localState` → button → `$if` → `we-modal` pattern from the Create Space modal (line ~325).

### 6. Post rendering (basic cards)

**File:** `packages/app-framework/src/shared/schemas/DefaultTemplate.schema.ts`

Start with basic template-defined cards showing CollectionBlock properties as text fields. Each post card shows `display`, `direction`, `format`, and `version` using `$if` guards for optional string fields.

Later we can figure out how to load the full block tree and render rich content.

---

## File Changes Summary

| File                        | Change                                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `SpaceStore.tsx`            | Register block models (JS class + SHACL on perspective), add `createPost(json)` action, remove `getPosts` / `posts` signal |
| `DefaultTemplate.schema.ts` | Replace `$store: spaceStore.posts` with `$query`, add create button + modal with BlockComposer                             |
| `BlockComposer.tsx`         | Remove `perspective` prop, change `onSave` to emit Lexical JSON instead of persisting                                      |
| `types.ts` (block-shared)   | Change `BlockComposerProps`: remove `perspective`, add `onSave?: (json) => void`                                           |
| `SpaceStore.tsx`            | Register block models (JS class + SHACL on perspective), add `createPost(json)` action, remove `getPosts` / `posts` signal |

---

## Questions / Decisions Needed

1. **Post rendering depth:** Should we render the full block tree (via BlockRenderer) or just show a text summary for each post in the list? Full rendering is richer but heavier.
2. **Modal vs route:** Should creating a post be a modal overlay or a separate `/posts/new` route? (Plan assumes modal for quick composition.)
3. **Post metadata:** Should we add author/timestamp display to posts? The `CollectionBlock` model doesn't have a `timestamp` property — we'd need to pull it from the AD4M link metadata or add a property.
4. **Children loading:** `$query` returns flat CollectionBlock models with `children` as an array of URIs. Do we need to recursively load children for rendering, or is the root-level data sufficient for a post list view?
