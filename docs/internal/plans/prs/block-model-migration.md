# Plan: Move Block Models to `@we/models`

> Prerequisite for `$query`. Decouples AD4M model definitions from the Lexical block composer package.

---

## Problem

TextBlock, ImageBlock, and CollectionBlock are defined inside `@we/block-system/shared/src/models/`. This couples their definitions to the Lexical block composer — any package that needs the model classes (e.g. the `$query` service, AI context extraction) must depend on `@we/block-system`.

`@we/models` already exists with the right role: it houses `WeNode` (the base class all blocks extend) and `Space`. Block model definitions belong here.

## Current structure

```
@we/models/
  src/
    WeNode.ts              ← base class
    entities/
      Space.ts             ← entity model
    utils/
      imageHelpers.ts
    index.ts               ← exports WeNode, Space, image utils

@we/block-system/
  shared/
    src/
      models/
        TextBlock.ts       ← imports WeNode from @we/models
        ImageBlock.ts       ← imports WeNode from @we/models
        CollectionBlock.ts  ← imports WeNode from @we/models
        index.ts
      serialization.ts     ← imports block models from ./models
      types.ts
      index.ts             ← re-exports models + serialization
  solid/
    src/
      ...Lexical UI...
```

## Target structure

```
@we/models/src/
  WeNode.ts
  entities/
    Space.ts
  blocks/                 ← NEW directory
    TextBlock.ts          ← moved from block-system
    ImageBlock.ts         ← moved from block-system
    CollectionBlock.ts    ← moved from block-system
    index.ts              ← barrel export
  utils/
    imageHelpers.ts
  index.ts                ← add blocks re-export

@we/block-system/
  shared/src/
    registry.ts           ← NEW: registerBlock(), blockRegistry, BlockRegistration type
    serialization.ts      ← import from '@we/models', use registry instead of if-branches
    types.ts
    index.ts              ← re-export from '@we/models' for back-compat + export registry
  solid/src/
    GenericBlockNode.ts   ← NEW: single DecoratorNode for all non-text blocks
    TextBlockNode.ts      ← existing (the one custom Lexical node for rich text)
    core-blocks.ts        ← NEW: imports models from @we/models + components from @we/components,
                             calls registerBlock() for each core block
    components/
      BlockComposer.tsx   ← imports core-blocks.ts, uses GenericBlockNode in nodes array

@we/components/src/       ← block editor components live here (or @we/widgets for complex ones)
  ImagePlayer/
    ImagePlayer.tsx        ← moved from block-system/solid/src/nodes/ImageNode/
    index.ts
```

### Architecture: three layers

| Layer                      | Package                          | Depends on                                  |
| -------------------------- | -------------------------------- | ------------------------------------------- |
| **Model** (pure AD4M data) | `@we/models`                     | `@coasys/ad4m` only                         |
| **Component** (SolidJS UI) | `@we/components` / `@we/widgets` | `@we/models` + `solid-js`                   |
| **Editor integration**     | `@we/block-system`               | `@we/models` + `@we/components` + `lexical` |

`@we/block-system` is strictly the **editor integration layer**. It owns the block registry, `GenericBlockNode`, `TextBlockNode`, `BlockComposer`, and the wiring (`core-blocks.ts`). It does not own models or UI components.

## Steps

1. **Create `@we/models/src/blocks/`** — move the 3 block model files verbatim (no code changes needed, they already `import { WeNode } from '@we/models'` which becomes a relative import `../WeNode`)
2. **Add barrel export** — `@we/models/src/blocks/index.ts` re-exports all three
3. **Update `@we/models/src/index.ts`** — add `export { TextBlock, ImageBlock, CollectionBlock } from './blocks'`
4. **Create `@we/block-system/shared/src/registry.ts`** — `registerBlock()`, `blockRegistry` Map, `BlockRegistration` type, `resolveBlockType()` using registry lookup
5. **Create `@we/block-system/solid/src/GenericBlockNode.ts`** — single Lexical `DecoratorNode` that looks up `editorComponent` from the registry by block type
6. **Move `ImageNode` component to `@we/components/`** — the SolidJS component (not the Lexical node) moves to the component library
7. **Create `@we/block-system/solid/src/core-blocks.ts`** — imports models from `@we/models`, imports components from `@we/components`, calls `registerBlock()` for each
8. **Update `@we/block-system/shared/src/serialization.ts`** — use registry lookup instead of if-branches
9. **Update `BlockComposer.tsx`** — use `GenericBlockNode` in the nodes array instead of individual node classes
10. **Update `@we/block-system/shared/src/index.ts`** — re-export blocks from `@we/models` for back-compat + export registry
11. **Delete `@we/block-system/shared/src/models/`** directory
12. **Update any other imports** — grep for `from '@we/block-system'` importing block model classes and point them to `@we/models`
13. **Verify build** — `pnpm build` across affected packages

## Import path change in block files

The block models currently do:

```typescript
import { WeNode } from '@we/models';
```

After moving into `@we/models` itself, this becomes:

```typescript
import { WeNode } from '../WeNode';
```

This is the only code change in the model files themselves.

## Back-compatibility

`@we/block-system/shared/src/index.ts` currently exports block models. After the move, it re-exports from `@we/models`:

```typescript
// Back-compat: consumers importing blocks from @we/block-system still work
export { TextBlock, ImageBlock, CollectionBlock } from '@we/models';
```

This means existing code doesn't break. New code should import from `@we/models` directly.

## Risk

Low-Medium. Core is still a file move + import path updates. The registry, `GenericBlockNode`, and `core-blocks.ts` are new code but straightforward — replacing hardcoded if-branches with a data structure. The ImageNode component move requires verifying it works from its new location in `@we/components`. All changes are build-verifiable.
