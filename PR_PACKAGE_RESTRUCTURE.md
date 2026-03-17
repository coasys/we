# Restructure: Align package naming with `design-system` conventions

## Summary

Renames and restructures `schema-renderer`, `block-composer`, and `models` packages into multi-package directories that mirror the existing `design-system/` layout. Also normalises package naming across the workspace.

**Branch:** `refactor/package-restructure`
**137 files changed** — mostly renames/moves, ~860 insertions, ~460 deletions

## What changed

### Directory moves
| Before | After |
|--------|-------|
| `packages/schema-renderer/` | `packages/schema-system/` |
| `packages/block-composer/` | `packages/block-system/` |
| `packages/models/` | `packages/block-system/models/` |

### Package renames
| Old name | New name | Notes |
|----------|----------|-------|
| `@we/schema-renderer` | Split into two ↓ | Was a single flat package |
| — | `@we/schema-shared` | Framework-agnostic types, validators, prop resolvers, mutations |
| — | `@we/schema-solid` | SolidJS renderer |
| `@we/block-composer-solid` | `@we/block-solid` | SolidJS block editor |
| — | `@we/block-shared` | **New** — extracted serialization + types from BlockComposer |
| `@we/models` | `@we/models` | Unchanged name, moved into `block-system/` |
| `@we/design-system-types` | `@we/design-types` | Shorter, consistent |
| `@we/design-system-utils` | `@we/design-utils` | Shorter, consistent |

### New packages
- **`@we/schema-shared`** (`schema-system/shared/`) — Extracted from the old monolithic `@we/schema-renderer`. Contains types (`SchemaNode`, `SchemaProp`, `TemplateSchema`, etc.), validators, mutations, prop resolvers, zod schemas. Zero framework dependencies.
- **`@we/block-shared`** (`block-system/shared/`) — Extracted `createBlocks()` serialization logic and shared types (`BlockComposerProps`, `SerializedBlockNode`) out of `BlockComposer.tsx` into a framework-agnostic package.

### Consumer updates
- `@we/app-framework` — all imports updated (`@we/schema-shared`, `@we/schema-solid`, `@we/block-solid`)
- `@we/pages` (6-pages) — imports and deps updated
- 31 files across the design-system updated for `design-types`/`design-utils` rename
- `pnpm-workspace.yaml` updated with new package paths

### Documentation
- README.md, VISION.md updated with new package names/paths
- Schema-system and block-system READMEs rewritten
- Completed todos marked in `docs/todos.md` and `docs/BLOCK-SYSTEM-NOTES.md`
- Full restructure plan preserved in `docs/PACKAGE-RESTRUCTURE-PLAN.md`

## Resulting structure

```
packages/
├── schema-system/
│   ├── shared/    → @we/schema-shared
│   └── solid/     → @we/schema-solid
├── block-system/
│   ├── shared/    → @we/block-shared
│   ├── solid/     → @we/block-solid
│   └── models/    → @we/models
├── design-system/
│   ├── types/     → @we/design-types
│   ├── utils/     → @we/design-utils
│   ├── 1-tokens/  → @we/tokens
│   ├── ...
```

## Naming convention established

- **Directory names** use `-system` suffix: `schema-system/`, `block-system/`, `design-system/`
- **Package names** use shortest unambiguous prefix: `@we/schema-shared`, `@we/block-solid`, `@we/design-types`
- **Packages with standalone identity** skip the prefix: `@we/tokens`, `@we/models`, `@we/primitives`

## Verification

- `pnpm install` — clean
- `@we/schema-shared` — builds, 52 tests pass
- `@we/schema-solid` — builds
- `@we/block-shared` — builds
- `@we/block-solid` — builds
- `@we/models` — builds
- `@we/app-framework` — builds (downstream consumer)

## Commits

1. `8e2e35a` — docs: add package restructure plan
2. `d0bf587` — phase 1: directory moves
3. `819614e` — phase 2: design-system-types/utils rename
4. `d89c43a` — phase 3: create schema-system sub-packages, rename block-solid
5. `d8c2ff6` — phase 4: create @we/block-shared, extract serialization
6. `46950ea` — phase 5: update pnpm-workspace.yaml
7. `7cbcdfc` — phase 6: update all consumer imports and dependencies
8. `32921c3` — phase 7: update documentation
9. `370169d` — phase 8: fix build issues and verify
