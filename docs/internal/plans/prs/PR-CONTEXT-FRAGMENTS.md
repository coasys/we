# PR: Declarative Context Discovery

## Problem

`@we/ai-context/src/generate.ts` hardcodes knowledge of every package's internals:

- `packages/design-system/3-primitives/custom-elements.json` — glob path for CEM
- `packages/design-system/4-components/src/**/*.types.ts` — ts-morph crawl
- `packages/design-system/5-widgets/src/**/*.types.ts` — ts-morph crawl
- `packages/design-system/1-tokens/src/*.ts` — token extraction
- `packages/models/src/blocks/*.ts`, `entities/*.ts` — model extraction

Adding a new context-providing package (e.g. `@we/block-solid`, a community package) requires modifying `generate.ts`. The dependency direction is backwards — a central tool reaches into packages rather than packages declaring what they expose.

## Solution

Packages declare what context they provide via a `"context"` field in `package.json`. The central `generate.ts` discovers these declarations by scanning workspace `package.json` files using glob, then calls the appropriate extractor for each. No hardcoded paths. No build ordering changes. No CLI bin.

## Architecture

```
packages/design-system/3-primitives/package.json    "context": { "type": "primitives" }
packages/design-system/4-components/package.json    "context": { "type": "components" }
packages/design-system/5-widgets/package.json       "context": { "type": "widgets" }
packages/design-system/1-tokens/package.json        "context": { "type": "tokens" }
packages/models/package.json                        "context": { "type": "models" }
        │
        ▼
  @we/ai-context/src/generate.ts
  1. Globs workspace for package.json files with "context" field
  2. Calls appropriate extractor for each discovered package
  3. Aggregates fragments into unified ContextData
  4. Generates instruction files + context.json + schemaContext.ts
```

Extraction still happens centrally (in `generate.ts`), but discovery is declarative. Each package owns its config; the extractor just follows it.

## Fragment Schema

Each extraction produces a `ContextFragment` — a subset of `ContextData`:

```ts
// packages/schema-system/shared/src/contextTypes.ts
export type ContextFragment = Partial<ContextData>;
```

Already exists in the codebase (added in previous PR).

## Context Config Format

Each package that provides AI context adds a `"context"` field to its `package.json`:

```json
{
  "context": {
    "type": "primitives"
  }
}
```

Optional `src` override for non-default source paths:

```json
{
  "context": {
    "type": "components",
    "src": "lib"
  }
}
```

**Supported types and defaults:**

| `context.type` | Extractor                          | `source` label | Default src            |
| -------------- | ---------------------------------- | -------------- | ---------------------- |
| `primitives`   | `extractPrimitives` (CEM)          | n/a            | `custom-elements.json` |
| `components`   | `extractComponentProps` (ts-morph) | `'components'` | `src`                  |
| `widgets`      | `extractComponentProps` (ts-morph) | `'widgets'`    | `src`                  |
| `tokens`       | `extractTokens` (ts-morph)         | n/a            | `src`                  |
| `models`       | `extractModels` (ts-morph)         | n/a            | `src`                  |

`components` and `widgets` use the same underlying extraction logic — the only difference is the `source` label stamped on each `ComponentEntry`.

## Changes

### 1. Refactor `extractComponents` → `extractComponentProps`

Current signature takes two dirs and labels them internally:

```ts
extractComponents(baseDirs?: { components?: string; widgets?: string }): ComponentEntry[]
```

New signature takes a single dir + explicit source label:

```ts
extractComponentProps(dir: string, source: 'components' | 'widgets'): ComponentEntry[]
```

This lets the discovery loop call it once per package with the correct label.

### 2. Update `generate.ts` — glob-based discovery

Replace hardcoded paths with workspace scanning:

```ts
import { globSync } from 'node:fs';

const DEFAULTS: Record<string, string> = {
  primitives: 'custom-elements.json',
  components: 'src',
  widgets: 'src',
  tokens: 'src',
  models: 'src',
};

function discoverFragments(): ContextFragment[] {
  const fragments: ContextFragment[] = [];

  const pkgPaths = [
    ...globSync('packages/*/package.json', { cwd: repoRoot }),
    ...globSync('packages/*/*/package.json', { cwd: repoRoot }),
  ];

  for (const rel of pkgPaths) {
    const abs = resolve(repoRoot, rel);
    const pkg = JSON.parse(readFileSync(abs, 'utf-8'));
    const config = pkg.context;
    if (!config?.type) continue;

    const pkgDir = dirname(abs);
    const src = resolve(pkgDir, config.src ?? DEFAULTS[config.type]);

    switch (config.type) {
      case 'primitives':
        fragments.push({ primitives: extractPrimitives(src) });
        break;
      case 'components':
        fragments.push({ components: extractComponentProps(src, 'components') });
        break;
      case 'widgets':
        fragments.push({ components: extractComponentProps(src, 'widgets') });
        break;
      case 'tokens':
        fragments.push({ tokens: extractTokens(src) });
        break;
      case 'models':
        fragments.push({ models: extractModels(src) });
        break;
      default:
        console.warn('Unknown context type "' + config.type + '" in ' + rel);
    }
  }

  return fragments;
}
```

### 3. Update `assembler.ts`

`assembleContext()` currently calls all four extractors directly. Update it to accept a `ContextData` parameter so `generate.ts` can pass in the aggregated data:

```ts
// Before
export function assembleContext(): AssembledContext {
  return {
    primitives: extractPrimitives(),
    components: extractComponents(),
    ...
  };
}

// After
export function assembleContext(contextData?: ContextData): AssembledContext {
  const data = contextData ?? discoverAndExtract();
  return {
    ...data,
    fragments: { schemaOperators, designSystemProps, routing, stores, storePatterns, rules },
  };
}
```

The fallback preserves backward compatibility — `assembleContext()` with no args still works.

### 4. Remove extractor exports from `index.ts`

Extractors are internal to `@we/ai-context`. Only the aggregated outputs are public:

```ts
// Keep
export type { AssembledContext } from './types.js';
export { schemaContext } from './schemaContext.js';
export { storeEntries } from './fragments/stores.js';
export { aggregateFragments, loadFragment } from './aggregate.js';

// Remove
// export { extractPrimitives } from './extractors/cem.js';
// export { extractComponents } from './extractors/typescript.js';
// export { extractTokens } from './extractors/tokens.js';
// export { extractModels } from './extractors/models.js';
```

### 5. Add `"context"` field to each package's `package.json`

| Package          | Addition                              |
| ---------------- | ------------------------------------- |
| `@we/primitives` | `"context": { "type": "primitives" }` |
| `@we/components` | `"context": { "type": "components" }` |
| `@we/widgets`    | `"context": { "type": "widgets" }`    |
| `@we/tokens`     | `"context": { "type": "tokens" }`     |
| `@we/models`     | `"context": { "type": "models" }`     |

No other changes to these packages. No devDep additions. No build step changes.

### 6. Future: community packages (Phase 2)

Community packages outside the workspace ship a pre-built `context.json`. The aggregator reads it from `node_modules`:

```ts
// Phase 2 addition to generate.ts
function discoverExternalFragments(): ContextFragment[] {
  // Read context.json from installed packages that declare a ./context export
  // Not implemented yet — added when community packages become real
}
```

The `"context"` config format is already compatible. Migration to a CLI approach (where each package runs extraction in its own build) is straightforward if needed later — same config, just different execution model.

---

## File Inventory

| File                                               | Change                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| `packages/ai-context/src/generate.ts`              | Replace hardcoded paths with glob-based discovery                              |
| `packages/ai-context/src/assembler.ts`             | Accept `ContextData` param instead of calling extractors directly              |
| `packages/ai-context/src/extractors/typescript.ts` | Refactor `extractComponents(baseDirs?)` → `extractComponentProps(dir, source)` |
| `packages/ai-context/src/index.ts`                 | Remove extractor exports                                                       |
| `packages/design-system/3-primitives/package.json` | Add `"context": { "type": "primitives" }`                                      |
| `packages/design-system/4-components/package.json` | Add `"context": { "type": "components" }`                                      |
| `packages/design-system/5-widgets/package.json`    | Add `"context": { "type": "widgets" }`                                         |
| `packages/design-system/1-tokens/package.json`     | Add `"context": { "type": "tokens" }`                                          |
| `packages/models/package.json`                     | Add `"context": { "type": "models" }`                                          |

## `@we/ai-context` Public API

| Export                 | Purpose                                              |
| ---------------------- | ---------------------------------------------------- |
| `schemaContext`        | The generated context string for AI prompts          |
| `storeEntries`         | Manually authored store metadata                     |
| `aggregateFragments()` | Merges `ContextFragment[]` into `ContextData`        |
| `loadFragment()`       | Reads a `context.json` file into a `ContextFragment` |

**NOT exported** (internal):

- `extractPrimitives`, `extractComponentProps`, `extractTokens`, `extractModels`

Types (`ContextData`, `ContextFragment`, etc.) are exported from `@we/schema-shared`.

## Migration Strategy

- **No build changes** — `generate.ts` runs during `@we/ai-context`'s existing `build:steps`, same as today
- **Output parity** — the generated output must be identical to the current monolith output
- **Backwards compatible** — `assembleContext()` with no args still works as a fallback
- **Validation** — diff generated output before/after to confirm parity

## Open Questions

1. **Store entries** — currently manually authored in `fragments/stores.ts`. Should stores self-declare via `"context"` too? Would need a new extractor type.
2. **Deduplication** — if two packages declare the same component name, should the aggregator warn or error?
3. **Fragment validation** — should discovered fragments be validated at generation time? Catches config errors early.
