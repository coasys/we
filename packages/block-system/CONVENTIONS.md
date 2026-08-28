# Block System — Design Conventions

Rules and patterns for building and maintaining the WE block system (`@we/block-shared` + `@we/block-solid`).

## Package Structure

| Directory           | Package            | Purpose                                                                                                        |
| ------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `shared/`           | `@we/block-shared` | Framework-agnostic: the content model, standoff marks, the Portable Text projection, the registry, persistence |
| `frameworks/solid/` | `@we/block-solid`  | SolidJS + ProseMirror: `BlockComposer`, `BlockRenderer`, all block components, the editor schema and plugins   |

All content-model, registry and persistence logic lives in `shared/` — the SolidJS layer only handles editing and rendering.

---

## Core Concepts

### The content model

A composition is an ordered list of **content blocks** (`ContentBlock` in `shared/src/content.ts`):

- A **text block** (`_type: 'block'`) is one canonical string, `text`, plus standoff `marks` —
  `{ start, end, type, …data }` ranges over it, offsets in **Unicode code points**. Its structural
  role is `style` (`normal` | `h1` | `h2` | `h3` | `blockquote`), `listItem` (`bullet` | `number` |
  `check`) and `level`.
- Every other block is a typed record: `_type` is its registry node type, its fields its model's.
- A **collection** (`_type: 'collection'`) holds a nested composition in `content`.
- `_key` is the block's model id once persisted.

This is **Portable Text with WE extensions**: `toPortableText` derives `children` spans and
`markDefs` beside the canonical `text`/`marks`, so a Portable Text consumer and a WE reader both
read the stored blob without converting. Content is data and never evaluated — nothing in a block
is an expression, and the renderer draws strings.

**A text block with `text` and no `marks` is one unmarked span.** A writer that knows nothing about
marks — the transcribe pipeline, the notes module — produces a well-formed block. Never require
`marks`.

### Marks

- **Decorators** are a closed set: `strong`, `em`, `underline`, `strike`, `code`. Adding one is
  editor, renderer and converter work; do not add one for a single use.
- **Annotations** are open by `type` and carry data: `link { href }`, `mention { did }`,
  `nodeLink { node }`. A mention is also written as a `we://mention` relation on the root, which is
  where "who is named in this post" is answered — nothing queryable lives only in `marks`.

### Where the truth is

The **models are canonical**: one model per block, linked through `children`, in the order the
composition has. `CollectionBlock.editorState` is a **cache** — the Portable Text projection of
those models, written on every save, kept because reading a post is one file read rather than a
hydration per block. It is regenerable (`loadBlocks` rebuilds the composition from the models). Nothing
is ever rewritten in place; a post converges when it is next saved.

### What is a block?

A block is a composable unit of content. Each block type is:

- An **AD4M model** (`@we/models`, in `src/manifest/blocks/`) — the persistence-level representation
- A **registration** (`registerBlock({ nodeTypes, model, entity })`) binding the `_type` to it
- A **display component** (read-only render) and an **input component** (edit-mode render)
- In the editor, a **schema node** derived from the registration by `createBlockSchema` — an atom
  whose fields live in a `props` attr. Nothing is hand-written per block on the editor side.

---

## Adding a New Block Type

1. **Create the model** in `@we/models/src/manifest/blocks/` (extend `WeNode`, add `version: number`
   — see `@we/models` CONVENTIONS), then `generate:types` and `generate:classes`.

2. **Register the model** in `@we/block-shared`'s `registerCoreBlocks()` (`shared/src/core-blocks.ts`):

   ```ts
   registerBlock({ nodeTypes: ['my-block'], model: MyBlock, entity: 'MyBlock' });
   ```

   The node type is what a content block carries as `_type`.

3. **Create display and input components** in `frameworks/solid/src/components/MyBlock/`:
   - `MyBlockDisplay.tsx` — read-only render, receives the block's fields as props
   - `MyBlockInput.tsx` — edit-mode render, receives the fields plus `onChange` and `isSelected`

4. **Register components** in `registerCoreBlockComponents()` (`frameworks/solid/src/core-block-components.ts`):

   ```ts
   updateBlockRegistration('my-block', { display: MyBlockDisplay, input: MyBlockInput });
   ```

5. If the block holds text people search for, add its fields to `TEXT_FIELDS_BY_TYPE` in
   `shared/src/serialization.ts`. If it stores binary assets, declare the property `format: 'file'`
   in the manifest — the upload and resolve passes key off that.

6. **Export** from `frameworks/solid/src/components/index.ts` if the components need to be public,
   and add the type to `BlockMenu.tsx` if people should be able to insert it.

The editor picks the new type up from the registry: it gets a schema node, a node view, drag
handles, the slash menu entry and persistence with no editor code.

---

## Block Components

### Input component contract

```tsx
function MyBlockInput(props: {
  // All block properties from the model, as a flat object
  [key: string]: unknown;
  // Callback to write a property change back through the editor (one undo step per change)
  onChange: (property: string, value: unknown) => void;
  // Reactive signal — true when this block is selected, or holds the control the pointer went down in
  isSelected: () => boolean;
}) { ... }
```

- **Always use `onChange`** to write property updates — never mutate state directly. `onChange`
  dispatches a transaction, which keeps history (undo/redo) consistent. Pass `undefined` to clear a
  property.
- **`isSelected` is a SolidJS signal** (a function), not a plain boolean. Use it reactively:
  `<Show when={props.isSelected()}>…</Show>`.
- Portal modals out (`<Portal>`), as `ImageInput` does — a modal inside the editor's DOM would be
  inside a `contenteditable` ancestor.

### Display component contract

```tsx
function MyBlockDisplay(props: {
  [key: string]: unknown; // block properties
}) { ... }
```

Display components are pure renderers — no editor context, no `onChange`. They must work in
`BlockRenderer`, which mounts them with no editor at all.

---

## The Editor (`frameworks/solid/src/editor/`)

| File                        | Owns                                                                                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema.ts`                 | The ProseMirror schema: text containers, custom-block atoms, the collection, the mention, the marks. **`toDOM` here is the only definition of a text block's DOM** — the renderer serialises through it |
| `converter.ts`              | ProseMirror document ⇄ content blocks. Code points on one side, UTF-16 on the other; a mention is a mark on one side and an atom on the other                                                           |
| `nodeViews.tsx`             | A Solid root per custom block rendering its input component; the collection's content DOM and toolbar                                                                                                   |
| `commands.ts`               | Transform, insert, move, list level, split/lift — one transaction per user act                                                                                                                          |
| `blockIndex.ts`             | Where the blocks are: positions and depths, recomputed from the document                                                                                                                                |
| `plugins/blockHandles`      | Handles, hover, drag-and-drop, OS file drops                                                                                                                                                            |
| `plugins/blockChrome`       | Hover/focus as **node decorations** — never set attributes on the editor's DOM from outside                                                                                                             |
| `plugins/placeholders`      | Placeholder text as decorations                                                                                                                                                                         |
| `plugins/keymap`            | The keyboard: lists, selected blocks, marks, history, then ProseMirror's base keymap                                                                                                                    |
| `plugins/inputRules`        | Markdown shortcuts, autolink                                                                                                                                                                            |
| `plugins/mentions`          | The `@` typeahead                                                                                                                                                                                       |
| `plugins/links`             | Paste-to-link, Mod-click to open, set/clear link                                                                                                                                                        |
| `plugins/formattingToolbar` | The floating selection toolbar                                                                                                                                                                          |
| `plugins/slashCommand`      | `/` in an empty block opens the type menu                                                                                                                                                               |

### Lists are flat

A list item is a block with `listType` and `level` attrs, not a child of a list container. That is
the storage shape (one `TextBlock` per item, with `listType`/`indent`), the Portable Text shape
(`listItem` + `level`), and what the chrome wants (every item has a handle). Markers and numbering
are CSS counters keyed on the attributes (`styles/blocks.scss`).

### Selecting a block that holds inputs

Clicking a block's wrapper selects it as a unit (a `NodeSelection`) and keeps the editor focused.
Clicking a **control** inside it must not move the editor's selection, or the control loses focus:
the node view lets such clicks through, and the composer's single document-level `mousedown`
listener records which wrapper the pointer went down in (`EditorContext.activeDom`), which is the
other half of `isSelected`. Never add a document listener per block — that is what the old editor
did, in read mode too, and a feed of twenty posts paid for a hundred of them.

### Never set attributes on the editor's DOM from outside

ProseMirror owns its DOM and re-renders nodes as the document changes; an attribute set by hand is
one edit away from vanishing. Hover, focus and placeholders are **decorations** (`blockChrome`,
`placeholders`). Positioning overlays read `view.nodeDOM(pos)` and measure it.

### The renderer never instantiates an editor

`BlockRenderer` walks the content: text blocks through the schema's `DOMSerializer`, custom blocks
through their display components, collections recursively. `tests/renderParity.test.tsx` proves the
composer's DOM and the renderer's are identical.

---

## Block Registration Timing

`registerCoreBlocks()` and `registerCoreBlockComponents()` are both called at module-load time
inside `BlockComposer` and `BlockRenderer`. They are idempotent (guarded by a flag). Custom blocks
should be registered before the first `BlockComposer` or `BlockRenderer` mounts; the schema is
built from the registry when a composer or renderer first needs it and rebuilt if the set of types
changes.

---

## CSS

Block styles are **not** included in the JS bundle (`sideEffects: false`). Consumers must import
separately:

```ts
import '@we/block-solid/styles';
```

---

## `BlockHostProvider`

The host tells the block system where it is mounted — the dataset to read and write, and who can
be @mentioned — once, so no template names a store to say so:

```tsx
<BlockHostProvider dataset={() => currentDataset} mentions={() => members}>
  <BlockComposer … />
</BlockHostProvider>
```

A `perspective` or `mentions` prop on a composer or renderer wins over the context.

## `BlockDisplayOverrides`

To replace the default display component for a block type in a specific render context without
modifying the global registry:

```tsx
<BlockDisplayOverrides overrides={{ image: MyCustomImageCard }}>
  <BlockRenderer editorState={...} />
</BlockDisplayOverrides>
```

---

## Persistence

Persistence lives in `@we/block-shared/src/serialization.ts`.

**Save:** `createBlocks(perspective, document)` uploads any `FileData` assets (replacing them with
file-storage addresses), creates one model per block linked via `children`, writes the Portable
Text blob and the `textContent` search index onto the root, and reconciles `we://mention` edges.

**Edit:** `reconcileBlocks(perspective, root, document)` updates blocks whose `_key` survived,
creates the rest, and computes removals **against `document.base`** — the keys the author loaded —
so a block another agent added meanwhile is kept and re-linked rather than deleted. It refuses any
collection whose `mode` is not `document` (see `modes.ts`).

**Load:** `decodeEditorState(blob)` accepts the current blob, a document or bare blocks;
`loadBlocks(perspective, rootId)` rebuilds the composition from the models when there is no blob, or
the blob is behind.

The composer's `onSave` hands over a `ContentDocument` — `{ _type: 'document', blocks, base }` —
and `spaceStore.createPost` / `updatePost` pass it straight through.

---

## Common Mistakes

| Mistake                                             | Why it breaks                                                             | Fix                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| Mutating block props directly                       | Bypasses the editor's history; undo/redo breaks                           | Always use `onChange(property, value)`             |
| Setting `data-*` on a block's element from a plugin | ProseMirror re-renders the node and the attribute is gone                 | Use a node decoration                              |
| A document listener per block                       | A feed pays for one per block per post                                    | Read `EditorContext.activeDom`                     |
| Offsets in UTF-16 units in `marks`                  | An emoji shifts every mark after it on any non-JS reader                  | Code points — `cpLength`, `utf16ToCp`, `cpToUtf16` |
| Requiring `marks` on a `TextBlock`                  | The notes module and the transcribe pipeline write `text` only            | Treat a missing `marks` as one unmarked span       |
| Forgetting `import '@we/block-solid/styles'`        | Block handles/highlights/placeholders invisible                           | Always import styles in the consumer               |
| Treating `isSelected` as a boolean                  | `isSelected` is a SolidJS signal — calling it as a value skips reactivity | Always call it: `props.isSelected()`               |
| Rendering a post through a read-only editor         | A feed mounts an editor per card                                          | `BlockRenderer` walks; only the composer edits     |
