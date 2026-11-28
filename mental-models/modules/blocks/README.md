# Blocks

A **block** is one unit of content in a composition: a text block, or a typed record such as an image, a task or a poll. A composition is an ordered list of blocks, kept as one record for each block, linked from a `CollectionBlock` root through `children`. `@we/block-shared` holds the content format, the registry and persistence. `@we/block-solid` holds the composer and the renderer.

**Why:** The records are the truth, and the root's `editorState` is a cache of their Portable Text form, so reading a post is one read and not one read for each block (`block-system/CONVENTIONS.md`). A collection's `mode` is written on the record, and is not looked up from its `kind`: a lookup would depend on which modules the reading client has, and a client without the module could then destroy the collection (`modes.ts` header).

**Parent:** [Modules](../README.md)

## Parts

- [Persistence](persistence.md): save, edit and load of a composition, and the three collection modes.
- [Composer](composer.md): the ProseMirror editor, the renderer, and live co-editing with Yjs.

<details><summary>How it works</summary>

**The content format** (`ContentBlock`, `content.ts`):

- A text block (`_type: 'block'`) is one `text` string and standoff `marks` (`{ start, end, type, … }`, offsets in Unicode code points), with `style`, `listItem` and `level`. A text block without `marks` is one unmarked span, so transcription and notes write only `text`.
- Decorators are a closed set (`strong`, `em`, `underline`, `strike`, `code`). Annotations are open, for example `link`, `mention` and `nodeLink`.
- Some marks are drawn and never stored: bare URLs (`withFoundLinks`) and markdown in a typed line (`markdownToBlocks`).
- `toPortableText` adds Portable Text `children` and `markDefs` beside `text` and `marks`.

**The registry** (`registry.ts`). `registerBlock({ nodeTypes, model, entity, input? })` binds a `_type` to an entity class (`model`). `registerCoreBlocks` registers the core types: `root`/`collection`, `block`, `image`, `audio`, `video`, `file`, `event`, `task`, `location`, `link`, `tag`, `code`, `callout`, `divider`, `embed`. `updateBlockRegistration` adds the display and input components (`registerCoreBlockComponents`).

**Module blocks.** A module declares `blocks: [{ entity, card, nodeType?, input? }]`. The `_type` is `nodeType`, or the entity name in lower case. The registry registers the block when the module's entities are compiled, at the first dataset install (`registerModuleBlocks`), and warns about an entity, a card part or an input component that the module does not declare. The host draws the card part (`moduleBlockDisplays.tsx`).

</details>

<details><summary>Where in the code</summary>

- [packages/block-system/shared/src/](../../../packages/block-system/shared/src): `content.ts`, `marks.ts`, `links.ts`, `markdown.ts`, `registry.ts`, `core-blocks.ts`, `serialization.ts`, `modes.ts`.
- [packages/block-system/frameworks/solid/src/](../../../packages/block-system/frameworks/solid/src): `@we/block-solid`.
- [packages/app-shell/src/shared/registries/moduleRegistry.ts](../../../packages/app-shell/src/shared/registries/moduleRegistry.ts): `registerModuleBlocks`, `moduleBlockNodeType`.
- [packages/module-system/shared/src/module.ts](../../../packages/module-system/shared/src/module.ts): `BlockContribution`.
- [packages/block-system/CONVENTIONS.md](../../../packages/block-system/CONVENTIONS.md): how to add a block type. [packages/block-system/README.md](../../../packages/block-system/README.md).
- The block entities (`TextBlock`, `CollectionBlock`, …): [Entities](../../data/entities/README.md).

</details>
