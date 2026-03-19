# Model Reorganization Plan

## Decision Summary

- **`WeNode`** — shared base model extending `Ad4mModel`. Carries universal social primitives: `comments`, `reactions`, `semanticRole`.
- **Blocks** — content models that participate in `ad4m://has_child` compositions (TextBlock, ImageBlock, CollectionBlock, etc.). Extend `WeNode`. Live in the block-system.
- **Entities** — structural/organizational models (Space, Profile, etc.). Extend `WeNode`. Live in a standalone `@we/models` package.

## Current State

```
packages/block-system/
  models/          ← @we/models (contains Block, Space, TextBlock, ImageBlock, CollectionBlock)
  shared/          ← @we/block-shared (serialization + types, depends on @we/models)
  solid/           ← @we/block-solid (Lexical editor, depends on @we/models + @we/block-shared)
```

Problems:
1. Entity models (Space) live inside the block-system despite not being blocks
2. Block models are in a separate nested package from the serialization code that constructs them
3. The `Block` wrapper model creates a separate AD4M instance alongside each typed block (TextBlock etc.) rather than being a parent class
4. `WeNode` base class doesn't exist yet — no shared comments/reactions inheritance
5. Block type models extend `Ad4mModel` directly, not the `Block` base

## Target State

```
packages/
  models/                       ← @we/models (NEW location: packages/models/)
    src/
      WeNode.ts                 ← NEW: shared base (comments, reactions, semanticRole)
      entities/
        Space.ts                ← MOVED from block-system/models/src/Space.ts
      index.ts                  ← exports WeNode + all entities
    package.json
    tsconfig.json
    tsup.config.ts

  block-system/
    models/                     ← DELETED (package removed entirely)
    shared/                     ← @we/block-shared (block models + serialization + types)
      src/
        models/
          TextBlock.ts          ← MOVED from block-system/models/src/block-types/
          ImageBlock.ts         ← MOVED from block-system/models/src/block-types/
          CollectionBlock.ts    ← MOVED from block-system/models/src/block-types/
        serialization.ts        ← UPDATED imports
        types.ts                ← unchanged
        index.ts                ← UPDATED: re-exports block models + serialization + types
      package.json              ← UPDATED: add @we/models dependency (already has it)
    solid/                      ← @we/block-solid (unchanged structure)
      package.json              ← UPDATED: depend on @we/block-shared, remove @we/models
```

## Implementation Steps

### Step 1: Create `packages/models/` as `@we/models`

Create the new standalone package at `packages/models/`:
- `package.json` — name: `@we/models`, depends on `@coasys/ad4m`
- `tsconfig.json` — copy from current block-system/models/tsconfig.json
- `tsup.config.ts` — copy from current block-system/models/tsup.config.ts
- `src/WeNode.ts` — new base model with comments, reactions, semanticRole
- `src/entities/Space.ts` — moved from block-system/models/src/Space.ts, extended to use `WeNode`
- `src/index.ts` — exports `WeNode` and all entities

### Step 2: Move block models into `block-system/shared/`

- Create `block-system/shared/src/models/` directory
- Move `TextBlock.ts`, `ImageBlock.ts`, `CollectionBlock.ts` from `block-system/models/src/block-types/` into `block-system/shared/src/models/`
- Update each to extend `WeNode` (imported from `@we/models`) instead of `Ad4mModel`
- Update `block-system/shared/src/index.ts` to re-export block models
- Update `block-system/shared/package.json` — already depends on `@we/models`, no change needed

### Step 3: Delete `block-system/models/` package

- Remove `Block.ts` (the wrapper model — no longer needed, its concerns are on `WeNode`)
- Remove `block-system/models/src/`, `package.json`, `tsconfig.json`, `tsup.config.ts`
- Remove `block-system/models/dist/` and `block-system/models/node_modules/`

### Step 4: Update `pnpm-workspace.yaml`

Add `packages/models` to the workspace. The existing `packages/block-system/*` glob already covers the shared package.

```yaml
packages:
  - apps/*
  - apps/playgrounds/*/*
  - packages/*            # ← already covers packages/models/
  - packages/design-system/*
  - packages/schema-system/*
  - packages/block-system/*
```

No change needed — `packages/*` already matches `packages/models/`.

### Step 5: Update imports in consuming packages

**`@we/block-shared` (block-system/shared/src/serialization.ts)**
- Before: `import { Block, CollectionBlock, ImageBlock, TextBlock } from '@we/models'`
- After: `import { CollectionBlock, ImageBlock, TextBlock } from './models'` (local imports, Block removed)

**`@we/app-framework` (AdamStore.tsx)**
- Before: `import { Space } from '@we/models'`
- After: `import { Space } from '@we/models'` (unchanged — still from @we/models, just a different location)

**`@we/app-framework` (SpaceStore.tsx)**
- Before: `import { Block, CollectionBlock, ImageBlock, Space, TextBlock } from '@we/models'`
- After: `import { Space } from '@we/models'` + `import { CollectionBlock, ImageBlock, TextBlock } from '@we/block-shared'`

**`@we/widgets` (CreateSpaceModalWidget.solid.tsx)**
- Before: `import { Block, CollectionBlock, ImageBlock, Space, TextBlock } from '@we/models'`
- After: `import { Space } from '@we/models'` + `import { CollectionBlock, ImageBlock, TextBlock } from '@we/block-shared'`

**`@we/block-solid` (solid/package.json)**
- Remove `@we/models` dependency (block-solid gets models through `@we/block-shared`)
- Keep `@we/block-shared` dependency

**`apps/playgrounds/react/ad4m-model-testing/package.json`**
- Update dependency from `@we/models` to include `@we/block-shared` if it uses block types

### Step 6: Update package.json dependencies

Packages that use **only entities** depend on `@we/models`.
Packages that use **block types** depend on `@we/block-shared` (which itself depends on `@we/models`).
Packages that use **both** depend on both.

| Package | @we/models | @we/block-shared |
|---------|-----------|-----------------|
| app-framework | yes (Space) | yes (block types in SpaceStore) |
| design-system/5-widgets | yes (Space) | yes (block types in CreateSpaceModal) |
| block-system/shared | yes (WeNode base) | n/a (IS this package) |
| block-system/solid | no | yes |
| playgrounds/ad4m-model-testing | depends on usage | depends on usage |

### Step 7: Update documentation references

- `README.md` line 32 — update path from `./packages/block-system/models` to `./packages/models`
- `packages/app-framework/README.md` line 219 — update description
- `docs/architecture/package-conventions.md` lines 18, 32 — update package table

## Model Definitions (for reference)

### WeNode (packages/models/src/WeNode.ts)

```typescript
import { Ad4mModel, HasMany, HasManyMethods, Model, Property } from '@coasys/ad4m';

@Model({ name: 'WeNode' })
export class WeNode extends Ad4mModel {
  @HasMany({ through: 'we://has_comments' })
  comments: string[] = [];

  @HasMany({ through: 'we://has_reactions' })
  reactions: string[] = [];
}

export interface WeNode extends HasManyMethods<'comments' | 'reactions'> {}
```

### Space (packages/models/src/entities/Space.ts)

```typescript
import { HasMany, HasManyMethods, Model, Property } from '@coasys/ad4m';
import { WeNode } from '../WeNode';

@Model({ name: 'Space' })
export class Space extends WeNode {
  @Property({ through: 'we://has_name', required: true })
  name: string = '';

  @Property({ through: 'we://has_description', required: true })
  description: string = '';

  @Property({ through: 'we://has_visibility' })
  visibility: string = '';

  @HasMany({ through: 'we://has_location' })
  locations: string[] = [];
}

export interface Space extends HasManyMethods<'locations'> {}
```

### TextBlock (block-system/shared/src/models/TextBlock.ts)

```typescript
import { Model, Property } from '@coasys/ad4m';
import { WeNode } from '@we/models';

@Model({ name: 'TextBlock' })
export class TextBlock extends WeNode {
  // ... existing properties unchanged, just extends WeNode instead of Ad4mModel
}
```

Same pattern for ImageBlock, CollectionBlock, and future block types.
