# Package Restructure Plan: Three Systems

## Goal

Rename and restructure `schema-renderer`, `block-composer`, and the orphaned `models` package into a consistent multi-package layout that mirrors `design-system`:

```
packages/
├── design-system/          # Unchanged (L1-L7 atomic architecture)
├── schema-system/          # Was schema-renderer
├── block-system/           # Was block-composer (absorbs models)
├── app-framework/          # Unchanged
├── cesium-layers/          # Unchanged
├── cli/                    # Unchanged
└── utils/                  # Unchanged
```

---

## Current State

```
packages/
├── design-system/
│   ├── types/              → @we/design-system-types
│   ├── utils/              → @we/design-system-utils
│   ├── 1-tokens/           → @we/tokens
│   ├── 2-themes/           → @we/themes
│   ├── 3-primitives/       → @we/primitives
│   ├── 4-components/       → @we/components
│   ├── 5-widgets/          → @we/widgets
│   ├── 6-pages/            → @we/pages
│   └── 7-templates/        → @we/templates
│
├── schema-renderer/        → @we/schema-renderer (single flat package)
│   └── src/
│       ├── shared/         (types, validators, prop resolvers, mutations)
│       └── frameworks/
│           └── solid/      (RenderSchema, schemaUpdater)
│
├── block-composer/         → @we/block-composer-solid (single sub-package)
│   └── solid/              (BlockComposer, BlockRenderer, plugins)
│
├── models/                 → @we/models (orphaned, not part of any system)
│   └── src/
│       ├── Block.ts
│       ├── Space.ts
│       └── block-types/    (TextBlock, ImageBlock, CollectionBlock)
│
├── app-framework/          → @we/app-framework
├── cesium-layers/          → @we/cesium-layers
├── cli/                    → @we/cli
└── utils/                  → @we/solid-utils, @we/test-utils
```

### Problems

1. **`models/` is orphaned** — Block types are the core of the block system but sit alone, disconnected from block-composer.
2. **`schema-renderer` doesn't follow the multi-package pattern** — The framework split is internal (`src/shared/` vs `src/frameworks/solid/`) rather than separate workspace packages. Consumers who only need types/validators still pull in Solid as a peer dep.
3. **Block composer's scope is too narrow** — It's just the Lexical editor. Serialization logic is inline in `BlockComposer.tsx`. No shared types or containment logic exists as a reusable layer.
4. **Naming inconsistency** — `design-system` is a "system", but `schema-renderer` and `block-composer` describe single features, not the full scope of what these packages contain or will contain.

---

## Naming Convention

**Directory names** include `-system` for filesystem organization. **Package names** use the shortest unambiguous prefix — no "system" in the npm name.

| Directory | Package prefix | Example |
|-----------|---------------|----------|
| `design-system/` | `@we/design-` | `@we/design-types`, `@we/design-utils` |
| `schema-system/` | `@we/schema-` | `@we/schema-shared`, `@we/schema-solid` |
| `block-system/` | `@we/block-` | `@we/block-shared`, `@we/block-solid` |

Packages with strong standalone identity skip the prefix entirely: `@we/tokens`, `@we/primitives`, `@we/components`, `@we/models`.

This means `@we/design-system-types` and `@we/design-system-utils` get renamed to `@we/design-types` and `@we/design-utils` as part of this restructure.

---

## Target State

```
packages/
├── design-system/              # Unchanged
│   ├── types/                 → @we/design-types
│   ├── utils/                 → @we/design-utils
│   ├── 1-tokens/              → @we/tokens
│   ├── 2-themes/              → @we/themes
│   ├── 3-primitives/          → @we/primitives
│   ├── 4-components/          → @we/components
│   ├── 5-widgets/             → @we/widgets
│   ├── 6-pages/               → @we/pages
│   └── 7-templates/           → @we/templates
│
├── schema-system/              # Was schema-renderer
│   ├── shared/                → @we/schema-shared
│   │   └── src/
│   │       ├── types.ts           (SchemaNode, SchemaProp, etc.)
│   │       ├── propResolvers.ts   (resolveProp, resolveProps, splitProps)
│   │       ├── predicates.ts      (hasToken, etc.)
│   │       ├── validators.ts      (validateSchema)
│   │       ├── mutations.ts       (findMutations)
│   │       └── zodSchemas.ts
│   └── solid/                 → @we/schema-solid
│       └── src/
│           ├── SchemaRenderer.tsx
│           ├── schemaUpdater.ts
│           └── types.ts
│
├── block-system/               # Was block-composer + models
│   ├── models/                → @we/models (moved from packages/models/)
│   │   └── src/
│   │       ├── Block.ts
│   │       ├── Space.ts
│   │       └── block-types/
│   │           ├── TextBlock.ts
│   │           ├── ImageBlock.ts
│   │           └── CollectionBlock.ts
│   ├── shared/                → @we/block-shared (new — extracted from solid)
│   │   └── src/
│   │       ├── types.ts           (BlockComposerProps, shared block types)
│   │       └── serialization.ts   (Lexical ↔ AD4M block conversion)
│   └── solid/                 → @we/block-solid (was @we/block-composer-solid)
│       └── src/
│           ├── components/
│           │   ├── BlockComposer.tsx
│           │   ├── BlockRenderer.tsx
│           │   ├── BlockMenu/
│           │   └── ImageBlock/
│           ├── nodes/
│           └── plugins/
│
├── app-framework/
├── cesium-layers/
├── cli/
└── utils/
```

### Workspace config

```yaml
packages:
  - apps/*
  - apps/playgrounds/*/*
  - packages/*
  - packages/design-system/*
  - packages/schema-system/*
  - packages/block-system/*
  - packages/utils/*
```

### Package name mapping

| Old | New | Notes |
|-----|-----|-------|
| `@we/design-system-types` | `@we/design-types` | Shorter prefix, consistent convention |
| `@we/design-system-utils` | `@we/design-utils` | Shorter prefix, consistent convention |
| `@we/schema-renderer` | removed | Split into two packages below |
| — | `@we/schema-shared` | Framework-agnostic schema types, validators, resolvers |
| — | `@we/schema-solid` | SolidJS schema renderer |
| `@we/block-composer-solid` | `@we/block-solid` | Lexical editor + plugins |
| — | `@we/block-shared` | New — shared serialization & types |
| `@we/models` | `@we/models` | Same name, moved into block-system/ |

---

## Implementation Steps

### Phase 1: Create directory structure

1. Create `packages/schema-system/` directory
2. Create `packages/block-system/` directory
3. Move `packages/schema-renderer/src/shared/` → `packages/schema-system/shared/src/`
4. Move `packages/schema-renderer/src/frameworks/solid/` → `packages/schema-system/solid/src/`
5. Move `packages/schema-renderer/tests/` → `packages/schema-system/shared/tests/`
6. Move `packages/schema-renderer/OPERATORS.md` and `README.md` → `packages/schema-system/`
7. Move `packages/block-composer/solid/` → `packages/block-system/solid/`
8. Move `packages/models/` → `packages/block-system/models/`
9. Delete empty `packages/schema-renderer/` and `packages/block-composer/` and `packages/models/`

### Phase 2: Rename design-system internal packages

10. Rename `@we/design-system-types` → `@we/design-types` in `packages/design-system/types/package.json`
11. Rename `@we/design-system-utils` → `@we/design-utils` in `packages/design-system/utils/package.json`
12. Update all consumers of `@we/design-system-types` and `@we/design-system-utils`:
    - `packages/design-system/utils/package.json` (depends on types)
    - `packages/design-system/3-primitives/package.json` (depends on both)
    - `packages/design-system/4-components/package.json` (depends on utils)
    - `packages/design-system/5-widgets/package.json` (depends on utils)
    - Any import statements referencing the old names

### Phase 3: Create new package.json files

13. Create `packages/schema-system/shared/package.json` as `@we/schema-shared`
    - Move `zod` dependency here
    - No peer dependency on `solid-js`
    - Exports: `"."` → shared types, validators, prop resolvers
14. Create `packages/schema-system/solid/package.json` as `@we/schema-solid`
    - Peer dependency on `solid-js`
    - Dependency on `@we/schema-shared`
    - Exports: `"."` → RenderSchema, updateSchema, types
15. Add `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts` to each new sub-package
16. Update `packages/block-system/solid/package.json`: rename from `@we/block-composer-solid` → `@we/block-solid`
17. Update `packages/block-system/models/package.json`: keep as `@we/models` (no rename needed)

### Phase 4: Create block-shared package

18. Create `packages/block-system/shared/` with `package.json` as `@we/block-shared`
19. Extract serialization logic from `BlockComposer.tsx` `createBlocks()` → `packages/block-system/shared/src/serialization.ts`
20. Extract shared types from `BlockComposer.tsx` → `packages/block-system/shared/src/types.ts`
21. Update `BlockComposer.tsx` to import from `@we/block-shared`

### Phase 5: Update workspace config

22. Update `pnpm-workspace.yaml`:
    ```yaml
    packages:
      - apps/*
      - apps/playgrounds/*/*
      - packages/*
      - packages/design-system/*
      - packages/schema-system/*
      - packages/block-system/*
      - packages/utils/*
    ```
23. Remove old entries for `packages/block-composer/*`

### Phase 6: Update all consumers

24. Update `packages/app-framework/package.json`:
    - `@we/schema-renderer` → `@we/schema-solid`
    - `@we/block-composer-solid` → `@we/block-solid`
25. Update all import statements in `app-framework/`:
    - `from '@we/schema-renderer/solid'` → `from '@we/schema-solid'`
    - `from '@we/schema-renderer/shared'` → `from '@we/schema-shared'`
    - `from '@we/block-composer-solid'` → `from '@we/block-solid'`
26. Update `packages/design-system/6-pages/package.json`:
    - `@we/block-composer-solid` → `@we/block-solid`
27. Update import statements in `6-pages/`:
    - `from '@we/block-composer-solid'` → `from '@we/block-solid'`
28. Search entire workspace for any remaining references to old package names and update them

### Phase 7: Update documentation

29. Update `we/README.md` package listing
30. Update `we/docs/WE-ARCHITECTURE.md` if it references package names
31. Update any other docs referencing old names

### Phase 8: Verify

32. Run `pnpm install` to verify workspace resolution
33. Run `pnpm build` to verify all packages compile
34. Run tests across all packages
35. Verify dev server starts cleanly

---

## What's NOT changing

- **Design system structure** — no changes to directory layout or L1-L7 layers (only the `types` and `utils` package names shorten)
- **`@we/models` package name** — stays the same to minimize churn, just moves into `block-system/`
- **App framework** — stays as-is, just import paths updated
- **L5-L7 in design-system** — keeping widgets, pages, and templates in design-system despite their cross-system dependencies. If this causes issues later (e.g., circular deps when pages need the query service), we can promote them to a separate `app-views/` package or absorb them into `app-framework/`

## Future work (not part of this restructure)

- **Reactive query service** — will live in `schema-system/` (new sub-package or inside `schema-system/solid/`)
- **App store registration** (`defineAppStore`) — will live in `schema-system/`
- **Additional block types** (AudioBlock, VideoBlock, etc.) — will be added to `block-system/models/`
- **Default block renderers** — will be added to `block-system/solid/`
- **React framework targets** — `schema-system/react/`, `block-system/react/`
