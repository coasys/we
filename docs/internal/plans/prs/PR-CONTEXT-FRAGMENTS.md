# PR: Decentralized Context Fragments

## Problem

`@we/ai-context/src/generate.ts` is a central monolith that hardcodes knowledge of every package's internals:

- `packages/design-system/3-primitives/custom-elements.json` — glob path for CEM
- `packages/design-system/4-components/src/**/*.types.ts` — ts-morph crawl
- `packages/design-system/5-widgets/src/**/*.types.ts` — ts-morph crawl
- `packages/design-system/1-tokens/src/*.ts` — token extraction
- `packages/models/src/blocks/*.ts`, `entities/*.ts` — model extraction
- Store entries are manually authored in `fragments/stores.ts`

Adding a new component package (e.g. `@we/block-solid`, a community `@we/maps`) requires modifying the central extractor. The dependency direction is backwards — a central tool reaches into packages rather than packages declaring what they expose.

## Solution

Each package generates its own `context.json` fragment at build time. A lightweight aggregator merges fragments from dependencies into a unified context. No package needs to know about another's internals.

## Architecture

```
@we/primitives                  @we/widgets                 @we/block-solid
  build:context →                 build:context →             build:context →
  context.json                    context.json                context.json
  { primitives: [...] }           { components: [...] }       { components: [...] }
        │                               │                           │
        └───────────────┬───────────────┘───────────────────────────┘
                        ▼
              @we/ai-context (aggregator)
              - Discovers fragments from workspace packages
              - Merges into unified ContextData
              - Generates instruction files + context.json + schemaContext.ts
```

## Fragment Schema

Each fragment conforms to a subset of the existing `ContextData` interface — all fields optional:

```ts
// packages/schema-system/shared/src/contextTypes.ts
export interface ContextFragment {
  primitives?: PrimitiveEntry[];
  components?: ComponentEntry[];
  models?: ModelEntry[];
  tokens?: TokenCategory[];
  storeEntries?: StoreEntry[];
}
```

This is just `Partial<ContextData>`. The types already exist — `PrimitiveEntry`, `ComponentEntry`, etc. are defined in `contextTypes.ts`.

## Changes

### Phase 1 — Fragment infrastructure

#### 1. Add `ContextFragment` type — `schema-system/shared/src/contextTypes.ts`

```ts
/** A partial context that a single package exports */
export type ContextFragment = Partial<ContextData>;
```

#### 2. Per-package generate scripts

Each design-system package gets a small `generate-context.ts` script that:
- Imports the relevant extractor (already exists in `@we/ai-context`)
- Runs it against its own source
- Writes `context.json` to package root

**Extractor reuse:** The extractors (`cem.ts`, `typescript.ts`, `tokens.ts`, `models.ts`) move to `@we/schema-shared` so they're available to any package without depending on `@we/ai-context`. Alternatively, they stay in `@we/ai-context` and each package depends on it as a devDependency.

| Package | Extractor | Fragment shape |
|---------|-----------|---------------|
| `@we/primitives` | `extractPrimitives` (CEM) | `{ primitives: [...] }` |
| `@we/components` | `extractComponents` (ts-morph) | `{ components: [...] }` |
| `@we/widgets` | `extractComponents` (ts-morph) | `{ components: [...] }` |
| `@we/tokens` | `extractTokens` (ts-morph) | `{ tokens: [...] }` |
| `@we/models` | `extractModels` (ts-morph) | `{ models: [...] }` |
| `@we/block-solid` | `extractComponents` (ts-morph) | `{ components: [...] }` |

Each package adds to `package.json`:
```json
{
  "scripts": {
    "build:context": "tsx generate-context.ts"
  },
  "exports": {
    "./context": "./context.json"
  }
}
```

#### 3. Build aggregator — `@we/ai-context/src/aggregate.ts`

Replaces the hardcoded extraction calls in `generate.ts`:

```ts
import type { ContextData, ContextFragment } from '@we/schema-shared';

export function aggregateFragments(fragments: ContextFragment[]): ContextData {
  return {
    primitives: fragments.flatMap(f => f.primitives ?? []),
    components: fragments.flatMap(f => f.components ?? []),
    models: fragments.flatMap(f => f.models ?? []),
    tokens: fragments.flatMap(f => f.tokens ?? []),
    storeEntries: fragments.flatMap(f => f.storeEntries ?? []),
  };
}
```

#### 4. Fragment discovery

The aggregator discovers fragments via one of:

**Option A — Explicit list in `generate.ts` (simplest):**
```ts
const fragmentPaths = [
  require.resolve('@we/primitives/context'),
  require.resolve('@we/widgets/context'),
  // ...
];
```
Still a list, but now the extractor doesn't know HOW each package generates its types — it just reads the output.

**Option B — Workspace convention (zero-config):**
```ts
// Scan workspace packages for context.json
const { execSync } = require('child_process');
const packages = JSON.parse(execSync('pnpm ls --json --depth 0').toString());
// Read context.json from each package that has one
```

**Option C — Package.json exports field:**
Each package declares `"./context": "./context.json"` in exports. The aggregator resolves workspace deps and reads the export.

**Recommendation:** Start with Option A (explicit list), migrate to Option C once stable. Option B is over-engineered for now.

#### 5. Update `generate.ts`

```ts
// Before
const context = {
  primitives: extractPrimitives(resolve(designSystemRoot, '3-primitives/custom-elements.json')),
  components: extractComponents({ ... }),
  tokens: extractTokens(...),
  models: extractModels(...),
  storeEntries,
  fragments: { ... },
};

// After
const fragments = discoverFragments(); // reads context.json from each package
const contextData = aggregateFragments(fragments);
const context = {
  ...contextData,
  storeEntries, // stores stay manually authored for now
  fragments: { ... }, // AI narrative text stays here
};
```

### Phase 2 — Migrate design-system packages

One package at a time. Each migration:
1. Add `generate-context.ts` to the package
2. Add `"build:context"` script and `"./context"` export
3. Add to turbo pipeline (build:context runs after build)
4. Remove corresponding hardcoded path from aggregator's fallback

Order:
1. `@we/primitives` — simplest, just reads CEM
2. `@we/tokens` — standalone, no deps
3. `@we/widgets` — needs ts-morph, tests the component extractor
4. `@we/components` — same as widgets
5. `@we/models` — decorator-based extraction

### Phase 3 — Non-DS packages

6. `@we/block-solid` — first external consumer, validates the pattern works outside DS
7. Community packages — document the convention, add to contributor guide

---

## File Inventory

| File | Change |
|------|--------|
| `packages/schema-system/shared/src/contextTypes.ts` | Add `ContextFragment` type |
| `packages/ai-context/src/aggregate.ts` | New — fragment merging logic |
| `packages/ai-context/src/generate.ts` | Replace direct extraction with fragment aggregation |
| `packages/design-system/3-primitives/generate-context.ts` | New — runs extractPrimitives, writes context.json |
| `packages/design-system/3-primitives/package.json` | Add build:context script, ./context export |
| `packages/design-system/5-widgets/generate-context.ts` | New — runs extractComponents, writes context.json |
| `packages/design-system/5-widgets/package.json` | Add build:context script, ./context export |
| `packages/design-system/1-tokens/generate-context.ts` | New — runs extractTokens, writes context.json |
| `packages/design-system/1-tokens/package.json` | Add build:context script, ./context export |
| `packages/models/generate-context.ts` | New — runs extractModels, writes context.json |
| `packages/models/package.json` | Add build:context script, ./context export |
| `packages/block-system/frameworks/solid/generate-context.ts` | New — Phase 3 |
| `turbo.json` | Add build:context task to pipeline |

## Migration Strategy

- **Backwards compatible** — `generate.ts` falls back to direct extraction if a fragment isn't found. Packages can migrate incrementally.
- **No runtime changes** — the output (`context.json`, instruction files, `schemaContext.ts`) is identical. Only the build pipeline changes.
- **Validation** — diff the aggregated output against the current monolithic output to ensure parity before switching over.

## Open Questions

1. **Where do extractors live?** Keep in `@we/ai-context` (each package uses it as devDep) or move to `@we/schema-shared` (already a shared dep)?
2. **Store entries** — currently manually authored in `fragments/stores.ts`. Should stores also self-declare? Would require runtime introspection or a store registry pattern.
3. **Turbo pipeline ordering** — `build:context` must run after `build` (needs CEM, compiled types). Turbo handles this via `dependsOn`.
4. **Fragment validation** — should fragments be validated against the `ContextFragment` schema at generation time? Catches broken fragments early.
5. **Deduplication** — if two packages declare the same component name, should the aggregator warn or error?
