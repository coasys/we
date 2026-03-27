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
    serialization.ts      ← imports updated to '@we/models'
    types.ts
    index.ts              ← re-export blocks from '@we/models' for back-compat
```

Editor infrastructure (registry, `GenericBlockNode`, `core-blocks.ts`, ImageNode component extraction) is deferred to [core-block-types](core-block-types.md) (#5b), where it's needed to support new block types.

## Steps

1. **Create `@we/models/src/blocks/`** — move the 3 block model files verbatim (no code changes needed, they already `import { WeNode } from '@we/models'` which becomes a relative import `../WeNode`)
2. **Add barrel export** — `@we/models/src/blocks/index.ts` re-exports all three
3. **Update `@we/models/src/index.ts`** — add `export { TextBlock, ImageBlock, CollectionBlock } from './blocks'`
4. **Update `@we/block-system/shared/src/serialization.ts`** — update imports to use `@we/models` instead of `./models`
5. **Update `@we/block-system/shared/src/index.ts`** — re-export blocks from `@we/models` for back-compat
6. **Delete `@we/block-system/shared/src/models/`** directory
7. **Update any other imports** — grep for `from '@we/block-shared'` importing block model classes and point them to `@we/models`
8. **Verify build** — `pnpm build` across affected packages

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

Low. Pure file move + import path updates. No new code, no logic changes. All changes are build-verifiable.
