# PR Plan: Block System Completion

## Summary

Get the block system from its current state (text blocks working, image half-working) to a fully functional content creation and display system. Users should be able to compose rich content — from simple chat messages to complex document-style posts — and view saved block collections identically in the BlockRenderer. This covers wiring up display/input components for all block types, making the BlockRenderer visually identical to the BlockComposer, leveraging the existing `createBlockNodeClass` factory so we don't need a custom Lexical node per block type, and reorganising the block packages where needed.

---

## Current State

### What works

- **Text blocks** in the BlockComposer: paragraph, headings (h1–h3), quotes, bullet/numbered lists
- **Serialization** (`createBlocks`): saves Lexical editor state → AD4M block models with parent-child relationships
- **Loading** (`loadBlocks`): reconstructs block tree from AD4M
- **Block registry**: 15 core block types registered (models only, no components except image)
- **Slash command menu**: shows all block type categories (text, collection, media, social) but only text transforms work
- **Block handles**: drag-to-reorder and hover highlighting in the composer
- **`createBlockNodeClass` factory**: generic Lexical DecoratorNode factory exists, uses BlockBridge to switch between display/input components

### What's broken or missing

- **No roundtrip from AD4M back to Lexical** — `loadBlocks()` returns AD4M model instances, but no function converts them back to the Lexical serialized JSON that `editor.parseEditorState()` needs. Without this, saved posts can't be displayed in BlockRenderer from AD4M data.
- **Inline text formatting is lost on save** — `extractInlineText()` flattens bold/italic/underline spans into a single plain text string, discarding Lexical format bits. Roundtrip destroys rich text formatting.
- **List wrapper nodes not persisted** — `list` nodes are pass-through in `createBlocks()`, so reconstruction must re-synthesise them from `listitem` metadata.
- **BlockRenderer looks different** from BlockComposer — different font, no block highlighting on hover, generally unstyled
- **ImageBlock** is half-working — custom `ImageNode` exists but should migrate to `createBlockNodeClass` factory
- **12 block types have no components**: Audio, Video, File, Code, Callout, Divider, Embed, Event, Link, Location, Tag, Task
- **`transformBlock()`** in helpers.ts only handles text types + image — can't insert media/social blocks from the slash menu
- **No `INSERT_BLOCK_COMMAND`** generalised command — only `INSERT_IMAGE_COMMAND` exists as a one-off
- **BlockMenu** lists all types but selecting a non-text/non-image type does nothing

---

## Architecture Decisions

### 1. One generic Lexical node via `createBlockNodeClass`, not N custom nodes

We already have the factory (`createBlockNodeClass`). The current `ImageNode` is a legacy hand-rolled DecoratorNode that predates the factory. We should:

- Migrate ImageBlock to use the factory
- Register all new block types via the factory
- Remove `ImageNode` and `ImageBlockPlugin` once migrated

Each block type only needs a **display component** (read-only) and an **input component** (editable) registered via `registerCoreBlockComponents()`. The factory + BlockBridge handle all Lexical coupling.

### 2. Display vs Input component contract

Following the ImageBlock pattern already established:

```
Display component (props only):
  - Receives block data as props (src, title, text, etc.)
  - No Lexical imports, no onChange
  - Used in read-only mode (BlockRenderer) and schema views

Input component (props + onChange + isSelected):
  - Receives block data as props + onChange(property, value) + isSelected() + onSelect()
  - No Lexical imports — BlockBridge handles the coupling
  - Can compose the Display component internally and layer edit affordances on top
```

### 3. BlockRenderer must share styles with BlockComposer

The renderer currently uses its own wrapper class (`we-block-renderer-wrapper`) and has no access to the composer's block styles. Fix: extract shared block styles into a common stylesheet that both wrapper classes use.

### 4. Block insertion via a single generic command

Replace `INSERT_IMAGE_COMMAND` with a generic `INSERT_BLOCK_COMMAND` that takes a node type + initial props. The `transformBlock()` helper should also be extended to handle factory-created block nodes.

---

## Implementation Plan

### Phase 1: BlockRenderer Style Parity

**Goal:** Saved content looks identical in the renderer and composer.

**Files:**

- `frameworks/solid/src/components/BlockComposer.scss` → extract shared block styles
- New: `frameworks/solid/src/styles/blocks.scss` — shared `.we-block` styles (padding, border-radius, typography, list markers, blockquote bar, etc.)
- `frameworks/solid/src/styles/index.scss` — import the shared stylesheet
- `frameworks/solid/src/components/BlockRenderer.tsx` — apply shared wrapper class

**Changes:**

1. Extract all block-level styles from `BlockComposer.scss` into `blocks.scss` — the core `.we-block` styling, typography for `p`, `h1`–`h3`, `blockquote`, `li`, list markers, counters, nesting
2. Keep composer-only styles (highlighting on hover via `data-block-highlighted`, editing affordances) in `BlockComposer.scss`
3. Create `blocks.scss` with a shared root class (e.g. `.we-block-content`) that both `.we-block-composer-editor` and `.we-block-renderer` `@extend` or include
4. Add `font-family: var(--we-font-family)` and `color: var(--we-color-neutral-900)` to the shared styles
5. In BlockRenderer.tsx, apply the shared class to the content editable wrapper
6. Add optional hover highlighting in the renderer for individual blocks (subtle, no editing affordances)

**Acceptance:** Render the same saved post in both BlockComposer (via `post` prop) and BlockRenderer — they should look identical in typography, spacing, list styles, and quote styling.

---

### Phase 2: Migrate ImageBlock to Factory & Create Generic Insert Command

**Goal:** Remove the bespoke ImageNode, use `createBlockNodeClass` for images, and create a reusable block insertion mechanism.

**Files:**

- `frameworks/solid/src/nodes/ImageNode/` → delete after migration
- `frameworks/solid/src/plugins/ImageBlockPlugin/` → replace with generic `BlockInsertPlugin`
- `frameworks/solid/src/helpers.ts` — extend `transformBlock` + add `INSERT_BLOCK_COMMAND`
- `frameworks/solid/src/components/BlockComposer.tsx` — update node registration and plugin imports

**Changes:**

1. **Create `ImageBlockNode` via factory:**

   ```ts
   // In BlockComposer.tsx or a new nodes/index.ts
   const ImageBlockNode = createBlockNodeClass('image');
   ```

2. **Create generic `INSERT_BLOCK_COMMAND`:**

   ```ts
   export const INSERT_BLOCK_COMMAND = createCommand<{ type: string; props?: Record<string, unknown> }>(
     'INSERT_BLOCK_COMMAND',
   );
   ```

3. **Create `BlockInsertPlugin`** (replaces `ImageBlockPlugin`):
   - Listens for `INSERT_BLOCK_COMMAND`
   - Creates a factory node via `$createBlockNode(NodeClass, props)` and inserts it at current selection
   - Works for any block type that has been registered via `createBlockNodeClass`

4. **Extend `transformBlock()`:**
   - For non-text block types (image, audio, video, etc.), replace the current paragraph with a factory-created decorator node
   - For text block types, keep existing behaviour (paragraph ↔ heading ↔ quote ↔ list)

5. **Update `findNodeType()`** to recognise factory-created nodes (check `$isBlockNode` from the factory)

6. **Register all factory node classes** in BlockComposer's `initialConfig.nodes`:

   ```ts
   const ImageBlockNode = createBlockNodeClass('image');
   const AudioBlockNode = createBlockNodeClass('audio');
   const VideoBlockNode = createBlockNodeClass('video');
   // ... etc
   ```

7. **Delete** `nodes/ImageNode/`, `plugins/ImageBlockPlugin/`

**Acceptance:** Can insert an image via slash menu → image option. Existing image functionality (URL input, display, delete) still works through the registered ImageInput/ImageDisplay components.

---

### Phase 3: Display & Input Components for Media Blocks

**Goal:** Audio, Video, File, and Embed blocks can be inserted, edited, and displayed.

For each block type, create a `Display` component (read-only) and an `Input` component (editable), then register them in `core-block-components.ts`.

#### AudioBlock

- **AudioDisplay**: Shows audio player (`<audio>` element) with title and artist
- **AudioInput**: URL input for audio source, text fields for title/artist, composes AudioDisplay when loaded

#### VideoBlock

- **VideoDisplay**: Shows `<video>` element or iframe embed for YouTube/Vimeo URLs, with title
- **VideoInput**: URL input, auto-detects provider, shows preview, composes VideoDisplay when loaded

#### FileBlock

- **FileDisplay**: Shows file icon + name + size, download link
- **FileInput**: URL/upload input for file, name field

#### EmbedBlock

- **EmbedDisplay**: Shows iframe or oEmbed card for external URLs
- **EmbedInput**: URL input, display mode selector (card vs inline)

**File structure per block type:**

```
components/
  AudioBlock/
    index.ts
    AudioDisplay.tsx
    AudioInput.tsx
    AudioBlock.scss
  VideoBlock/
    ...
  FileBlock/
    ...
  EmbedBlock/
    ...
```

**Registration in `core-block-components.ts`:**

```ts
updateBlockRegistration('audio', { display: AudioDisplay, input: AudioInput });
updateBlockRegistration('video', { display: VideoDisplay, input: VideoInput });
updateBlockRegistration('file', { display: FileDisplay, input: FileInput });
updateBlockRegistration('embed', { display: EmbedDisplay, input: EmbedInput });
```

**Acceptance:** Each block type can be inserted via slash menu, edited inline, saved, and rendered identically in BlockRenderer.

---

### Phase 4: Display & Input Components for Structural/Utility Blocks

**Goal:** Code, Callout, Divider, and Link blocks work end-to-end.

#### CodeBlock

- **CodeDisplay**: Renders code with syntax highlighting (use a lightweight highlighter or `<pre><code>` with language class), shows language label
- **CodeInput**: `<textarea>` or contenteditable for code entry, language selector dropdown

#### CalloutBlock

- **CalloutDisplay**: Styled box with icon + text, variant-based colouring (info/warning/error/success)
- **CalloutInput**: Text input + variant selector, composes CalloutDisplay

#### DividerBlock

- **DividerDisplay**: Horizontal rule with style variant (solid/dashed/dotted)
- **DividerInput**: Style selector (minimal — a divider has almost no editable content)

#### LinkBlock

- **LinkDisplay**: Card preview with title, description, thumbnail (link preview card)
- **LinkInput**: URL input with metadata auto-fetch (title, description, thumbnail), composes LinkDisplay when loaded

**Acceptance:** Same as Phase 3 — insert, edit, save, render.

---

### Phase 5: Display & Input Components for Social/Data Blocks

**Goal:** Event, Task, Location, and Tag blocks work end-to-end.

#### EventBlock

- **EventDisplay**: Card showing title, date/time range, location, description
- **EventInput**: Form fields for title, start/end dates (date pickers), location, description

#### TaskBlock

- **TaskDisplay**: Checkbox + title + status badge + priority indicator + optional due date
- **TaskInput**: Title input, status/priority selectors, date picker for due date, assignee field

#### LocationBlock

- **LocationDisplay**: Map pin icon + name + address (static display; embedded map is a future enhancement)
- **LocationInput**: Name, address, lat/lng fields

#### TagBlock

- **TagDisplay**: Coloured pill/badge with tag name
- **TagInput**: Tag name input + colour picker

**Acceptance:** Same as above.

---

### Phase 6: Lossless Serialization Roundtrip

**Goal:** All block types survive the full compose → save → load → render cycle with identical Lexical trees.

This is the most architecturally critical phase. The current save/load paths have fundamental gaps that prevent faithful reconstruction.

#### Current data flow and gaps

```
SAVE (works, but lossy):
  Lexical editor state
    → editorState.toJSON() → SerializedBlockNode tree
    → createBlocks() → AD4M block models
    ⚠️ Inline text nodes (bold/italic spans) merged into single `text` string
    ⚠️ `list` wrapper nodes are pass-through (not persisted)

LOAD (incomplete):
  AD4M block models
    → loadBlocks() → model tree with _loadedChildren
    ❌ No conversion back to Lexical serialized JSON
    ❌ BlockRenderer expects SerializedBlockNode for editor.parseEditorState()
```

#### Problem 1: No `blocksToLexicalJSON()` function

`loadBlocks()` returns AD4M model instances. But `BlockRenderer` and `BlockComposer` (when loading a post for editing) both call `editor.parseEditorState({ root: post })` which expects Lexical's serialized JSON format. **There is no function that converts the loaded AD4M model tree back into Lexical JSON.** This is the most immediate gap — without it, the only way to display a saved post is to store and pass the original Lexical JSON alongside the AD4M data, defeating the purpose.

#### Problem 2: Inline text formatting is destroyed

`extractInlineText()` concatenates plain text from Lexical inline children, discarding format metadata:

```
Lexical JSON (what the editor produces):
  paragraph.children = [
    { type: "text", text: "Hello ", format: 1 },   ← bold
    { type: "text", text: "world", format: 0 }      ← normal
  ]

After createBlocks():
  TextBlock.text = "Hello world"   ← format bits LOST

Reconstruction cannot recover:
  paragraph.children = [
    { type: "text", text: "Hello world", format: 0 }  ← all normal, wrong
  ]
```

#### Problem 3: List wrapper reconstruction

Lexical requires `list` nodes wrapping `listitem` children. `createBlocks()` treats `list` as pass-through and stores metadata (`listType`, `tag`, `start`) on each `listitem` TextBlock. Reconstruction must re-synthesise the wrapping `list` node from this metadata.

#### Solution: Dual storage — block tree + Lexical blob

Store the full Lexical serialized JSON as a **single file-storage blob on the root CollectionBlock**, using the same pattern as `Template.schema`. The block tree continues to exist alongside it for structure, queryability, and AI tool access.

**Architecture rationale — why both layers are needed:**

The two layers serve fundamentally different access patterns:

- **Blob** = rendering a single document fast. One fetch → parse → render. Lossless formatting. Source of truth for the Lexical editor.
- **Block tree** = querying across documents. `AudioBlock.findAll(perspective)` returns every audio block across every post, playlist, and composition — regardless of nesting. A Spotify-style template queries AudioBlocks; a social feed queries CollectionBlocks; a search queries TextBlocks by content. Same data, different views.

This is a **document store + relational index** over the same data. The blob is the document, the block tree is the index. Both generated atomically from the same Lexical editor state at save time. The redundancy is intentional:

```
                        ┌─────────────────────────────┐
                        │     Lexical editor state     │
                        │       (source at save)       │
                        └──────────┬──────────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    ▼                             ▼
          ┌─────────────────┐           ┌─────────────────┐
          │  editorState    │           │   Block tree     │
          │  (file blob)    │           │  (AD4M models)   │
          ├─────────────────┤           ├─────────────────┤
          │ Render full doc │           │ Cross-collection │
          │ Lossless format │           │   queries        │
          │ Fast single     │           │ AI tool CRUD     │
          │   fetch         │           │ Text search      │
          │ Editor reload   │           │ Interop layer    │
          └─────────────────┘           └─────────────────┘
               WE-specific              AD4M-universal
```

The block tree is also the **interop layer**: other communities or apps can read your blocks via AD4M without your editor. They get plain text, images, audio — no formatting fidelity, but structurally correct. The blob is WE-specific; the blocks are AD4M-universal.

**Why a single blob on the root (not per-block):**

| Approach                                                      | Verdict                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| JSON string property per TextBlock (`inlineChildren: string`) | Hacky, possible literal size limits, JSON-in-a-string on every paragraph                   |
| File storage blob per TextBlock                               | 50 paragraphs = 50 content-addressed blobs = significant save/load overhead                |
| **Single file storage blob on root CollectionBlock**          | **One blob, perfect fidelity, same proven pattern as `Template.schema`, minimal overhead** |

This mirrors exactly how Templates work: the `Template` model stores its schema as a single `FileData` blob via `resolveLanguage: FILE_STORAGE_LANGUAGE` + `transform: decodeFileAsJson`. A saved post (root CollectionBlock) is the same concept — a structured document with a canonical representation.

**Files:**

- `packages/models/src/blocks/CollectionBlock.ts` — add `editorState` file-storage property
- `shared/src/serialization.ts` — save Lexical JSON blob alongside block tree, load it back
- `packages/models/src/utils/fileTransforms.ts` — reuse existing `decodeFileAsJson`

**Changes:**

1. **Add `editorState` property to CollectionBlock** — stores the full Lexical serialized JSON via file storage, same as `Template.schema`:

   ```ts
   import { FILE_STORAGE_LANGUAGE } from '../constants';
   import { decodeFileAsJson } from '../utils/fileTransforms';

   @Model({ name: 'CollectionBlock' })
   export class CollectionBlock extends WeNode {
     // ... existing properties ...

     @Property({
       through: 'we://editor_state',
       resolveLanguage: FILE_STORAGE_LANGUAGE,
       transform: decodeFileAsJson,
     })
     editorState: Record<string, unknown> = {};
   }
   ```

2. **Update `createBlocks()`** — after creating the block tree (unchanged), also store the Lexical JSON blob on the root CollectionBlock:

   ```ts
   export async function createBlocks(perspective, node) {
     return Ad4mModel.transaction(perspective, async (tx) => {
       // Existing block tree creation (unchanged)
       const root = await persist(node);

       // Store Lexical JSON blob on root for lossless roundtrip
       if (root && hasEditorState(root)) {
         const jsonBytes = new TextEncoder().encode(JSON.stringify(node));
         const base64 = btoa(String.fromCharCode(...jsonBytes));
         root.editorState = { data_base64: base64, name: 'editor-state.json', file_type: 'application/json' };
         await root.save(perspective, { batchId: tx.batchId });
       }

       return root;
     });
   }
   ```

3. **Update `loadBlocks()`** — when loading a root CollectionBlock, return its `editorState` (already decoded by the `transform`) so callers can pass it directly to `editor.parseEditorState()`:

   ```ts
   // loadBlocks already hydrates the root — editorState comes along for free
   // via the @Property transform. Callers use it:
   const root = await loadBlocks(perspective, rootUri);
   const lexicalJSON = root.editorState; // already decoded by decodeFileAsJson
   // Pass to BlockRenderer: <BlockRenderer post={lexicalJSON.root} />
   ```

4. **Block tree still created** — `createBlocks()` continues to build the full AD4M block tree. The `text` property on TextBlock still holds plain text (via `extractInlineText`). This gives:
   - `$query` against TextBlock for search ("find posts containing X")
   - AI-generated CRUD tools for individual blocks
   - Cross-community readability (graceful degradation)
   - Semantic role tagging on individual blocks

5. **Fallback for missing blob** — if `editorState` is empty (e.g. old data, cross-community content without the blob), fall back to `blocksToLexicalJSON()` which reconstructs a best-effort Lexical tree from the block tree. This is the lossy path (no bold/italic), but provides graceful degradation:

   ```ts
   export function blocksToLexicalJSON(rootBlock: Ad4mModel): SerializedBlockNode {
     // Best-effort reconstruction from block tree:
     // - Root CollectionBlock → { type: 'root', children: [...] }
     // - TextBlock → { type: block.type, children: [{ type: 'text', text: block.text }], ... }
     // - Listitem TextBlocks → re-wrap in { type: 'list', ... }
     // - Decorator blocks → { type: 'image', src, altText, ... }
   }
   ```

6. **Blob ↔ block tree consistency** — the dual storage creates a potential drift problem. If something mutates the block tree without going through the composer (e.g. an AI tool deletes a TextBlock, or another community member edits a block directly), the blob still contains the old content.

   **Who can cause drift:**
   - AI tools — auto-generated CRUD ops (`textblock_delete`, `collectionblock_update`)
   - Direct AD4M link manipulation — another app or automation
   - Cross-community edits — someone modifies blocks without the blob

   **Strategy by phase:**

   _MVP (this PR):_ The BlockComposer is the only editor. Every save regenerates both the blob and the block tree atomically. No drift is possible through normal usage. AI tools that mutate individual blocks won't exist yet (they'd need to be explicitly wired up). This is sufficient.

   _Near-term (when AI block tools land):_ AI CRUD tools for blocks should **invalidate the blob** when they mutate the tree. The simplest mechanism: clear the `editorState` property (or set a `editorStateStale: true` flag) when any child block is created, updated, or deleted outside the composer. On next load, the renderer detects the missing/stale blob and falls back to `blocksToLexicalJSON()`. This means:
   - AI deletes a paragraph → blob cleared → renderer uses block tree fallback → deleted paragraph is gone (correct) but formatting is simplified (acceptable)
   - User opens post in composer → composer uses block tree fallback to populate editor → user saves → fresh blob generated with current formatting

   _Longer-term (if needed):_ A reconciliation step on load that walks both the blob and block tree, keeping the blob's formatting but filtering out nodes whose corresponding block no longer exists in the tree. This is more complex but gives best-of-both-worlds: formatting preserved for unmodified blocks, deletions/additions reflected immediately. Not needed for MVP.
   - Compose rich text with bold/italic spans → save → load → render → verify formatting preserved
   - Compose lists (bullet, numbered, nested) → save → load → verify list structure intact
   - Compose mixed content (headings, quotes, images, lists) → full roundtrip
   - Verify `editorState` blob decodes to identical Lexical JSON
   - Verify fallback `blocksToLexicalJSON()` produces reasonable output when blob is missing
   - Compose each non-text block type → verify all properties survive roundtrip

7. **Handle edge cases:**
   - DividerBlock has no text content — just type + style
   - CodeBlock uses `code` property not `text`
   - CollectionBlock nested children ordering must be preserved
   - Empty blocks (no text, no children) must still roundtrip
   - Blocks with required fields that might be empty at save time

**Acceptance:** Full roundtrip for every block type. `loadBlocks(createBlocks(lexicalJSON)).editorState` produces a Lexical tree identical to the original input. Fallback `blocksToLexicalJSON()` produces a usable (if formatting-lossy) tree when the blob is absent.

---

### Phase 7: Package Cleanup & Reorganisation

**Goal:** Clean file structure, clear separation of concerns.

**Changes:**

1. **Move `ImageBlock.tsx`** (the legacy Lexical-coupled component) out of the active tree or delete it — it's superseded by `ImageDisplay`/`ImageInput`

2. **Consolidate component file structure:**

   ```
   components/
     BlockComposer.tsx
     BlockComposer.scss
     BlockRenderer.tsx
     BlockDisplayOverrides.tsx
     BlockMenu/
     blocks/              ← all block-type components live here
       ImageBlock/
       AudioBlock/
       VideoBlock/
       FileBlock/
       CodeBlock/
       CalloutBlock/
       DividerBlock/
       EmbedBlock/
       EventBlock/
       TaskBlock/
       LocationBlock/
       LinkBlock/
       TagBlock/
   ```

3. **Clean up `helpers.ts`:**
   - Remove image-specific `$createImageNode`/`$isImageNode` imports after ImageNode deletion
   - Generalise `findNodeType()` to use factory type detection

4. **Remove commented-out React code** across all files (SlashCommandPlugin, ImageBlock, etc.) — these are leftovers from the React→Solid migration

5. **Update barrel exports** in `index.ts` files

---

## Out of Scope (Future Work)

### Re-saving & block tree diffing

MVP: every save through the composer deletes old child blocks and recreates the full block tree + blob atomically. This is simple and correct but loses child block URIs on each save (anything referencing a specific block URI — e.g. a reaction on a paragraph — would break).

Future: diff the new Lexical JSON against the existing block tree. Match nodes by position/content, update changed blocks in-place (preserving URIs), add new ones, remove deleted ones. This is the same problem CRDTs solve — worth deferring until there's a concrete need (e.g. per-block reactions or annotations).

### Cross-composition embedding & live-linked content

When a user embeds someone else's content into their composition (e.g. quoting a paragraph from another post, including an AudioBlock from a shared playlist), two modes are possible:

**Snapshot (copy at embed time):**

- Block tree: new models created (copies of the originals, own URIs)
- Blob: content captured inline at save time
- Behaviour: frozen at embed time. Original author's later edits don't affect your composition
- Use case: quoting, archiving, "here's what they said at the time"

**Live reference (link to original):**

- Block tree: your `CollectionBlock.children` includes the original block's AD4M URI (no copy)
- Blob: content captured at save time (still a snapshot)
- Behaviour: block tree always reflects current state; blob may be stale
- Use case: shared playlists, collaborative documents, "always show the latest version"

**Detecting updates — blob nodes carry source URIs:**

Each node in the saved blob could carry an optional `sourceUri` field (the AD4M URI of the block it was created from). On load, the renderer or editor could:

1. For each blob node with a `sourceUri`, query the live AD4M model
2. Compare the blob's snapshot values against the live model's current values
3. If they differ, flag the node as "updated since last save" (visual indicator)
4. User decides: accept the update (merge live data into blob) or keep the snapshot

```
Blob node at save time:
  { type: "paragraph", text: "Hello world", sourceUri: "ad4m://Qm...abc", ... }

On next load, query TextBlock(id: "ad4m://Qm...abc"):
  → text: "Hello world, updated!"
  → Flag: "This block has been modified by its author"
  → User action: [Accept update] [Keep original]
```

This gives users control: retain the original (citation integrity) or pull in updates (live collaboration). The `sourceUri` metadata is cheap to add — it's just one extra field in the blob JSON per node. The reconciliation UI and query-on-load logic is the complex part.

**For MVP:** All saves create independent block trees (snapshot/copy mode). No cross-composition embedding. `sourceUri` metadata can be added to the blob format now as an empty/optional field without implementing the reconciliation logic, so the format is forward-compatible.

### Other deferred items

- **Reactions/likes** on posts and individual blocks — mentioned as a later task
- **Collection blocks** (grid, columns, rows) — these are in the BlockMenu but need a more complex nested editor UX; defer to a follow-up PR
- **Poll and Game blocks** — listed in BlockMenu but no models exist yet; defer
- **File upload** — current implementation uses URL input; actual file upload via AD4M file storage is future work
- **oEmbed / link preview fetching** — EmbedBlock and LinkBlock inputs can accept URLs now; auto-fetching metadata is an enhancement
- **Drag-and-drop reordering** for non-text blocks — current BlockHandlesPlugin may need updates for decorator nodes
- **Collaborative editing** — real-time sync of editor state across users
- **Block-level comments/annotations**
- **Mobile-specific input affordances**

---

## Risk & Open Questions

1. **Serialization roundtrip fidelity** is the highest-risk item. The current `createBlocks` is lossy for inline text formatting (bold, italic, underline, strikethrough, code spans). The solution is dual storage: a single file-storage blob (`editorState` on root CollectionBlock, same `resolveLanguage: FILE_STORAGE_LANGUAGE` pattern as `Template.schema`) for pixel-perfect rendering, alongside the existing block tree for queryability and interop. The block tree's `text` property holds plain text for search; the blob holds the full Lexical editor state. A `blocksToLexicalJSON()` fallback reconstructs a best-effort (formatting-lossy) tree when the blob is absent (e.g. cross-community content). Risk: blob and block tree could drift out of sync if blocks are edited individually without updating the blob — but for MVP, edits always go through the composer which regenerates both.

2. **Lexical decorator node limitations**: Factory-created nodes render via `decorate()` which returns an HTMLElement and uses `solid-js/web`'s `render()` to mount components. This works but means these blocks live outside Lexical's normal text flow — they can't be selected/deleted via keyboard the same way text blocks can. Need to verify that BlockHandlesPlugin handles decorator nodes well for reordering and deletion.

3. **`transformBlock()` for decorator nodes**: Currently `transformBlock` replaces one ElementNode with another. Replacing a paragraph with a DecoratorNode (or vice versa) is a different operation — need to verify the node replacement logic handles this transition cleanly.

4. **Serialization property mapping**: The factory node's `exportJSON()` outputs `{ type, version, ...props }`. The `createBlocks` serializer uses `extractBlockData` which reads property metadata from the model class. These need to align — property names in the factory node's props must match the AD4M model's `@Property` field names (e.g. `audioUrl` not `audio_url`).

5. **Shared styles approach**: Need to decide between `@extend` (generates shared selectors in CSS output) vs `@mixin`/`@include` (duplicates styles but is more predictable). `@extend` is cleaner but can produce unexpected CSS in complex SCSS setups.

6. **Should simple blocks reuse text editing?** Some blocks (CalloutBlock, CodeBlock) contain text that users want to type into directly. These might work better as Lexical ElementNodes with custom rendering rather than DecoratorNodes. DecoratorNodes can't contain Lexical-managed text selections. Evaluate whether a hybrid approach (ElementNode for text-containing blocks, DecoratorNode for widget-style blocks) is needed.

---

## Phasing Summary

| Phase | Description                        | Blocks Affected              | Complexity |
| ----- | ---------------------------------- | ---------------------------- | ---------- |
| 1     | Renderer style parity              | All (visual)                 | Low        |
| 2     | Factory migration + generic insert | Image (migration)            | Medium     |
| 3     | Media block components             | Audio, Video, File, Embed    | Medium     |
| 4     | Structural block components        | Code, Callout, Divider, Link | Medium     |
| 5     | Social block components            | Event, Task, Location, Tag   | Medium     |
| 6     | Lossless serialization roundtrip   | All                          | **High**   |
| 7     | Package cleanup                    | N/A (refactor)               | Low        |

Phases 1–2 are prerequisites. **Phase 6 (serialization roundtrip) should be tackled alongside or immediately after Phase 1** — without `blocksToLexicalJSON()` and lossless inline text storage, saved posts can't be displayed from AD4M data, which blocks all end-to-end testing. Phases 3–5 can be parallelised across developers once Phase 2 and 6 are in place. Phase 7 can happen at any time.
