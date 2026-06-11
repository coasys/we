# Block System — Design Conventions

Rules and patterns for building and maintaining the WE block editor (`@we/block-shared` + `@we/block-solid`).

## Package Structure

| Directory           | Package            | Purpose                                                                  |
| ------------------- | ------------------ | ------------------------------------------------------------------------ |
| `shared/`           | `@we/block-shared` | Framework-agnostic: type definitions, block registry, AD4M serialization |
| `frameworks/solid/` | `@we/block-solid`  | SolidJS: `BlockComposer`, `BlockRenderer`, all block components, plugins |

All serialization, registry, and model logic lives in `shared/` — the SolidJS layer only handles rendering and interactivity.

---

## Core Concepts

### What is a block?

A block is a composable unit of rich content that can be created inline while a user is authoring a document. Each block corresponds to:

- A **Lexical DecoratorNode** class (the editor-level representation)
- An **AD4M model** (the persistence-level representation, defined in `@we/models`)
- A **display component** (read-only render)
- An **input component** (edit-mode render)

### The two-package split

`@we/block-shared` knows about blocks as data (models, serialization). It has no UI dependencies.
`@we/block-solid` knows about blocks as UI (Lexical nodes, SolidJS components). It imports `@we/block-shared` for registry and model lookups.

Consumer apps import from `@we/block-solid`. Only server-side serialization code should import from `@we/block-shared` directly.

---

## Adding a New Block Type

1. **Create the model** in `@we/models/src/blocks/` (extend `WeNode`, add `version: number` — see `@we/models` CONVENTIONS).

2. **Register the model** in `@we/block-shared`:

   ```ts
   registerBlock({ nodeTypes: ['my-block'], model: MyBlock });
   ```

   This is called from `registerCoreBlocks()` in `shared/src/core-blocks.ts`.

3. **Create display and input components** in `frameworks/solid/src/components/MyBlock/`:
   - `MyBlockDisplay.tsx` — read-only render, receives `nodeProps`
   - `MyBlockInput.tsx` — edit-mode render, receives `nodeProps`, `onChange`, `isSelected: () => boolean`

4. **Register components** in `@we/block-solid`:

   ```ts
   updateBlockRegistration('my-block', { display: MyBlockDisplay, input: MyBlockInput });
   ```

   Called from `registerCoreBlockComponents()` in `frameworks/solid/src/core-block-components.ts`.

5. **The node class is created automatically** — `createBlockNodeClass('my-block')` is called in `frameworks/solid/src/nodes/index.ts` and the result included in `blockNodeClasses`. No custom node class is needed unless you have sub-editor requirements (see [CollectionBlockNode](#collectionblocknode)).

6. **Export** from `frameworks/solid/src/index.ts` if the display/input components need to be public.

---

## Block Components

### Input component contract

```tsx
function MyBlockInput(props: {
  // All block properties from the AD4M model, as a flat object
  [key: string]: unknown;
  // Callback to write a property change back through Lexical's update cycle
  onChange: (property: string, value: unknown) => void;
  // Reactive signal — true when this block has NodeSelection in the editor
  isSelected: () => boolean;
}) { ... }
```

- **Always use `onChange`** to write property updates — never mutate state directly. `onChange` goes through `editor.update()` which keeps Lexical's history (undo/redo) consistent.
- **`isSelected` is a SolidJS signal** (a function), not a plain boolean. Use it reactively: `{props.isSelected() && <Toolbar />}`.

### Display component contract

```tsx
function MyBlockDisplay(props: {
  [key: string]: unknown; // block properties
}) { ... }
```

Display components are pure renderers — no editor context, no `onChange`. They must work in `BlockRenderer` (which is used both inside the editor and in standalone read-only views).

---

## The `createBlockNodeClass` Factory

All standard block types use `createBlockNodeClass(nodeType)` which:

1. Creates a unique Lexical `DecoratorNode` subclass for the given type string
2. Sets `contentEditable="false"` on the wrapper `.we-block` div
3. Registers `mousedown` handlers that maintain editor focus and set `NodeSelection`
4. Mounts a `BlockBridge` SolidJS component into the DOM via a lexical-solid Portal

**Never hand-write a DecoratorNode class** unless you need sub-editor state management (only `CollectionBlockNode` does this). The factory handles all focus/selection complexity so block developers don't have to.

### Why `contentEditable="false"`

The `.we-block` wrapper has `contentEditable="false"` to create an editing-host boundary. Without it, Lexical's `contentEditable="true"` root would intercept all keyboard and `beforeinput` events from shadow-DOM inputs inside the block, so typing in a block's input would be swallowed by Lexical instead of reaching the input.

### Why `e.preventDefault()` on mousedown

Clicking a `contentEditable="false"` element inside a contenteditable triggers a browser-level atom selection (`selectionchange`), which races against the async `editor.update()` that sets the Lexical `NodeSelection`. `e.preventDefault()` suppresses this browser behaviour so the editor root keeps DOM focus and Lexical's selection is not disrupted.

**Exception:** Clicks targeting a `contentEditable="true"` element inside the block (i.e. a nested Lexical editor in a `CollectionBlock`) pass through — the mousedown handler walks the DOM toward `.we-block` and returns early if it finds a nested contenteditable.

---

## Keyboard / Selection Model

All keyboard handling for decorator blocks is in `BlockKeyboardPlugin`. The plugin uses `SELECTION_CHANGE_COMMAND` to maintain a `lastSelectedDecoratorKey` that persists through the DOM race described above.

**The `getTargetDecorator()` helper** (internal to the plugin):

- Returns the current NodeSelection target if `$getSelection()` is a `NodeSelection`
- Falls back to `$getNodeByKey(lastSelectedDecoratorKey)` only when `$getSelection()` is `null` (the race condition case)
- Returns `null` when selection is a non-null `RangeSelection` (cursor is in a text block — no fallback)
- `lastSelectedDecoratorKey` is cleared when selection moves to a `RangeSelection`

This design means keyboard commands always work correctly whether the user navigated to a block via arrow keys (normal Lexical selection) or via click (race-prone selection).

**Keyboard behaviours (all `COMMAND_PRIORITY_CRITICAL`):**

| Key       | Context                       | Behaviour                                                               |
| --------- | ----------------------------- | ----------------------------------------------------------------------- |
| ArrowDown | Block selected                | Move to next sibling (NodeSelect if decorator, `selectStart()` if text) |
| ArrowUp   | Block selected                | Move to previous sibling                                                |
| ArrowDown | Cursor at end of text block   | Jump into following decorator block                                     |
| ArrowUp   | Cursor at start of text block | Jump into preceding decorator block                                     |
| Enter     | Block selected                | Insert empty paragraph after block, place cursor there                  |
| Backspace | Block selected                | Remove block, cursor to previous sibling's end                          |
| Delete    | Block selected                | Remove block, cursor to next sibling's start                            |

---

## `CollectionBlockNode`

`CollectionBlockNode` is the only hand-written node class. It is used by `CollectionBlock` — a block that itself contains a full nested Lexical editor (used for multi-column layouts, card grids, etc.).

### Why it can't use the factory

Sub-editor content must not be stored in `__props`. Calling `setProperty()` would trigger Lexical to re-render the decorator, unmounting and remounting the nested editor and destroying its content. Instead:

- A module-level `collectionNodeStates: Map<nodeKey, editorStateJSON>` stores child content outside the Lexical node tree
- `StateChangePlugin` inside `CollectionInput` writes to this map on every sub-editor update
- `exportJSON()` reads from this map at save time

### When to use `CollectionBlockNode` pattern

Only when your block needs to host a full nested Lexical editor. For any block with self-contained content (properties, files, external references), use the factory.

### `CollectionBlockNode` and focus

`CollectionBlockNode.createDOM` uses the same `e.preventDefault()` pattern as the factory, with the same nested-contenteditable exception. Clicks on the collection block's outer wrapper select the block as a unit in the parent editor; clicks inside the child editor pass through normally.

---

## `decorate()` Must Return a Stable Function Reference

`lexical-solid` calls `decorate()` on every editor update. If the function reference changes, the Portal unmounts and remounts — destroying all SolidJS component state (signals, effects, memos) in the block's UI.

The factory handles this with `decoratorFactoryCache`. If you ever write a custom node class, cache the factory:

```ts
// ✅ correct — same function reference across renders
private _decorateCache: (() => JSX.Element) | null = null;

decorate(): () => JSX.Element {
  if (!this._decorateCache) {
    this._decorateCache = () => <MyComponent nodeKey={this.__key} />;
  }
  return this._decorateCache;
}

// ❌ wrong — new function on every update → infinite remount
decorate(): () => JSX.Element {
  return () => <MyComponent nodeKey={this.__key} />;
}
```

---

## Block Registration Timing

`registerCoreBlocks()` and `registerCoreBlockComponents()` are both called at module-load time inside `BlockComposer` and `BlockRenderer`. They are idempotent (guarded by a flag). Custom blocks should be registered before the first `BlockComposer` or `BlockRenderer` mounts.

---

## CSS

Block styles are **not** included in the JS bundle (`sideEffects: false`). Consumers must import separately:

```ts
import '@we/block-solid/styles';
```

---

## `BlockDisplayOverrides`

To replace the default display component for a block type in a specific render context without modifying the global registry:

```tsx
import { BlockDisplayOverrides } from '@we/block-solid';

<BlockDisplayOverrides overrides={{ image: MyCustomImageCard }}>
  <BlockRenderer editorState={...} />
</BlockDisplayOverrides>
```

`BlockBridge` checks the override context before falling back to the registered `display` component.

---

## Serialization

Serialization lives in `@we/block-shared/src/serialization.ts`.

**Save:** `createBlocks(perspective, editorState)` walks the Lexical JSON tree, uploads any `FileData` assets (replacing them with AD4M CIDs), then creates AD4M model instances linked via `children` relations.

**Load:** `loadBlocks(perspective, collectionBlock)` reconstructs Lexical JSON from AD4M models. `BlockRenderer` then calls `resolveExpressionAddresses(perspective, node)` to swap CIDs back to `data:` URIs before parsing.

If your block stores binary assets (images, audio, files), store them as `FileData` objects in the AD4M model — `preUploadFileAssets()` handles the CID round-trip automatically.

---

## Common Mistakes

| Mistake                                                        | Why it breaks                                                             | Fix                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------- |
| Mutating block props directly                                  | Bypasses Lexical history; undo/redo breaks                                | Always use `onChange(property, value)`      |
| Returning new JSX from `decorate()`                            | Infinite Portal remount                                                   | Cache the factory function                  |
| Using `setProperty()` in `CollectionBlock`'s sub-editor update | Triggers decorator re-render, destroys sub-editor state                   | Write to `collectionNodeStates` map instead |
| Removing `contentEditable="false"` from `.we-block`            | Lexical intercepts block input keyboard events                            | Never remove it                             |
| Forgetting `import '@we/block-solid/styles'`                   | Block handles/highlights/placeholders invisible                           | Always import styles in the consumer        |
| Treating `isSelected` as a boolean                             | `isSelected` is a SolidJS signal — calling it as a value skips reactivity | Always call it: `props.isSelected()`        |
