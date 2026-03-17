# Package Conventions

This document describes the conventions used to organise packages in the WE monorepo. Follow these when adding or restructuring packages.

## Naming

### npm scope

All packages use the `@we/` scope.

### Directory names

Multi-package directories use a `-system` suffix to signal they contain sub-packages:

```
packages/
├── schema-system/    ← contains @we/schema-shared, @we/schema-solid
├── block-system/     ← contains @we/block-shared, @we/block-solid, @we/models
├── design-system/    ← contains @we/tokens, @we/primitives, @we/components, ...
```

### Package names

Use the **shortest unambiguous** name within the `@we/` scope:

| Package | Name | Rationale |
|---------|------|-----------|
| `schema-system/shared` | `@we/schema-shared` | Needs prefix — "shared" alone is ambiguous |
| `schema-system/solid` | `@we/schema-solid` | Needs prefix — "solid" alone is ambiguous |
| `design-system/types` | `@we/design-types` | Needs prefix — "types" alone is ambiguous |
| `design-system/1-tokens` | `@we/tokens` | Standalone identity — unambiguous without prefix |
| `block-system/models` | `@we/models` | Standalone identity — unambiguous without prefix |
| `design-system/3-primitives` | `@we/primitives` | Standalone identity — unambiguous without prefix |

## Package structure patterns

There are two patterns. The right choice depends on whether the shared code warrants its own package.

### Pattern A: Multi-package directory

Used when the shared layer is **substantial and independently useful** — it has its own consumers, tests, and dependency graph.

```
schema-system/
├── shared/              ← @we/schema-shared (own package.json)
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsup.config.ts
│   └── src/
│       ├── index.ts
│       ├── types.ts
│       ├── validators.ts
│       └── ...
└── solid/               ← @we/schema-solid (own package.json)
    ├── package.json     ← depends on @we/schema-shared via workspace:*
    ├── tsconfig.json
    ├── tsup.config.ts
    └── src/
        ├── index.ts
        └── SchemaRenderer.tsx
```

**Characteristics:**
- Separate `package.json`, `tsconfig.json`, `tsup.config.ts` per sub-package
- Each sub-package has its own `src/` directory
- Framework packages depend on shared via `workspace:*`
- Each builds and versions independently
- Adding a new framework (e.g. React) means adding a new sibling directory

**When to use:** The shared code has real substance (types, validators, serialization logic, its own test suite) and could have multiple independent consumers.

**Current examples:** `schema-system/`, `block-system/`

### Pattern B: Single package with internal directories

Used when the shared layer is **trivial or empty** and everything ships as one package.

```
4-components/
├── package.json         ← single @we/components package
├── tsconfig.json
├── tsup.config.ts
└── src/
    ├── shared/
    │   └── types.ts     ← minimal or empty
    └── solid/
        ├── index.ts
        └── components/
            └── ...
```

**Characteristics:**
- One `package.json` at the root
- One `src/` with `shared/` and `solid/` subdirectories inside
- Single build, single version
- Consumers use subpath exports: `@we/components/solid`

**When to use:** The shared code is minimal — real shared types/utils already live in external packages (`@we/design-types`, `@we/design-utils`).

**Current examples:** `design-system/4-components/`, `design-system/5-widgets/`

### Framework code placement

The convention differs by pattern:

- **Multi-package directories** (Pattern A): framework code lives as a **sibling** — `schema-system/shared/`, `schema-system/solid/`, `schema-system/react/`
- **Single-package directories** (Pattern B): framework code lives under `src/frameworks/` — `src/shared/`, `src/frameworks/solid/`

The `app-framework` package is an example of Pattern B with the `frameworks/` convention: `src/shared/`, `src/frameworks/solid/`.

## Adding a new package

1. Decide which pattern fits (see above)
2. For Pattern A: create a new directory under the appropriate `-system/` parent, add `package.json`, `tsconfig.json`, `tsup.config.ts`
3. For Pattern B: add a new directory under `src/`
4. Follow the naming rules for the `@we/` scope
5. Add the workspace glob to `pnpm-workspace.yaml` if needed (Pattern A requires `packages/your-system/*`)
6. Add a `README.md` with package purpose, usage, and API overview
