# @we/block-solid

SolidJS block composer and renderer for the WE block system, on ProseMirror. Part of a two-package system:

| Package                           | Purpose                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `@we/block-shared` (`../shared/`) | Framework-agnostic content model, standoff marks, Portable Text projection, registry, persistence |
| `@we/block-solid` (this package)  | SolidJS `BlockComposer`, `BlockRenderer`, all block components, the editor schema and plugins     |

For architecture, conventions, and how to add new block types, see [`CONVENTIONS.md`](./CONVENTIONS.md).

---

## Quick Start

```tsx
import { BlockComposer, BlockHostProvider, BlockRenderer, registerCoreBlockComponents } from '@we/block-solid';
import { registerCoreBlocks } from '@we/block-shared';
import '@we/block-solid/styles';

// Registration is idempotent — safe to call at module load time
registerCoreBlocks();
registerCoreBlockComponents();

// The host says where blocks live and who can be mentioned — once
<BlockHostProvider dataset={() => currentDataset} mentions={() => members}>
  {/* Editable composer — onSave receives a ContentDocument: { _type: 'document', blocks, base } */}
  <BlockComposer
    editorState={savedState}
    onReady={(api) => (save = api.save)}
    onSave={(doc) => spaceStore.updatePost(id, doc)}
  />

  {/* Read-only renderer — walks the content, instantiates no editor */}
  <BlockRenderer editorState={savedState} />
</BlockHostProvider>;
```

---

## Exports

### Components

| Export                  | Description                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `BlockComposer`         | The editor: one ProseMirror document per composition, with WE's chrome as plugins   |
| `BlockRenderer`         | Read-only walker with file-address resolution; `Blocks` renders a block list inline |
| `BlockHostProvider`     | Context: the dataset blocks read/write and the mention roster                       |
| `BlockDisplayOverrides` | Context provider to override display components per render                          |
| `BlockToolbar`          | The floating per-block settings toolbar shell input components use                  |

### Editor

| Export                                    | Description                                                            |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `createBlockSchema(customTypes)`          | The ProseMirror schema for a set of registered block types             |
| `contentToDoc` / `docToContent`           | Content blocks ⇄ ProseMirror document                                  |
| `blockToNode` / `nodeToBlock`             | One block ⇄ one node                                                   |
| `transformBlock(view, pos, type)`         | Change the block at `pos` to another kind (the block menu's operation) |
| `insertBlocks` / `insertBlockAtSelection` | Insert nodes beside a block, or at the selection                       |
| `moveBlock(view, from, to, before)`       | Reorder — into and out of collections — in one transaction             |

---

## Directory Structure

```
src/
├── components/
│   ├── BlockComposer.tsx         # The editor: EditorView + plugins + overlays
│   ├── BlockRenderer.tsx         # Read-only walker (text through the schema's serializer)
│   ├── BlockHost.tsx             # Dataset + mention roster context
│   ├── BlockDisplayOverrides.tsx # Context for display component overrides
│   ├── BlockMenu/                # Block-type picker (slash command, handle settings)
│   ├── BlockToolbar/             # Per-block settings toolbar shell
│   ├── BlockPlaceholder/         # Empty-state placeholder for media blocks
│   ├── CollectionBlock/          # CollectionDisplay (walker) + CollectionInput (layout toolbar)
│   └── <Type>Block/              # <Type>Display + <Type>Input per block type
├── editor/
│   ├── schema.ts                 # The ProseMirror schema — the one definition of the DOM
│   ├── converter.ts              # Content blocks ⇄ document
│   ├── nodeViews.tsx             # Custom-block and collection node views (Solid roots)
│   ├── commands.ts               # Transform / insert / move / list commands
│   ├── blockIndex.ts             # Block positions and depths
│   ├── context.ts                # What the chrome shares (EditorContext)
│   └── plugins/                  # handles, chrome, placeholders, keymap, input rules, mentions, links, toolbar, slash
├── core-block-components.ts      # registerCoreBlockComponents()
└── styles/
    ├── blocks.scss               # Shared block styles (composer and renderer)
    ├── editor.scss               # Composer chrome: toolbar, mention menu, ProseMirror essentials
    ├── handles.scss              # Block handles and the drop indicator
    ├── placeholders.scss         # Placeholder text
    ├── block-inputs.scss         # Block input UI styles
    └── index.scss                # Aggregator (exported as ./styles)
```

---

## Building & testing

```bash
pnpm build   # tsup + sass; CSS is emitted separately — consumers import @we/block-solid/styles
pnpm test    # converter round-trips and composer/renderer DOM parity (happy-dom)
```

## Used By

- `@we/we-web` — web launcher
- `@we/we-electron` — Electron desktop launcher
- `@we/we-tauri` — Tauri desktop launcher

## Related Packages

- `@we/block-shared` — framework-agnostic content model and persistence
- `@we/entities` — data models for all block types
- `@we/schema-solid` — schema-driven UI system that hosts `BlockComposer` in document views
