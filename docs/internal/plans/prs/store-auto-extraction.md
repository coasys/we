# Plan: Auto-Extract Store Context from Source

## Problem

Store entries in `@we/ai-context` are the **only hand-maintained data registry** in the AI context pipeline. Primitives, components, widgets, models, and tokens are all auto-extracted from source code. Stores are a hardcoded array in `packages/ai-context/src/fragments/stores.ts`:

```ts
export const storeEntries: StoreEntry[] = [
  {
    name: 'adamStore',
    state: ['loading', 'adamClient', 'me', 'mySpaces', ...],
    actions: ['navigate', 'addNewSpace', 'unlockAgent', 'setShowPassword'],
  },
  // ...
];
```

This has already caused a real bug: `createSpace` was added to `AdamStore.tsx` but never added to `storeEntries`. The validator reported `Unknown method "createSpace" on store "adamStore"` — a false positive caused by stale context, not a schema error.

**Root cause:** There's no automated connection between store source files and AI context. Adding/renaming/removing a store method requires manually updating a separate file in a different package. Nobody remembers.

## Proposal

Replace the hand-maintained `storeEntries` array with an auto-extractor that scans store source files using `@ai` JSDoc tags. Store authors annotate which state/actions are schema-accessible at the source — descriptions travel with the code.

### JSDoc Convention

```ts
// packages/app-framework/src/frameworks/solid/stores/AdamStore.tsx

/** @ai Array of the user's joined spaces */
const [mySpaces, setMySpaces] = createSignal<Space[]>([]);

/** @ai Whether the agent is being unlocked */
const [loginLoading, setLoginLoading] = createSignal(false);

/** @ai Creates a new space with perspective, SDNA, and optional neighbourhood */
async function createSpace(name: string, description: string, shared: boolean, imageFile?: File) { ... }

/** @ai Navigates to a route */
function navigate(to: string, options?: NavigateOptions) { ... }

// No @ai tag → excluded from context
function addNewSpace(space: Space) { ... }
```

Tags:
- `@ai <description>` on a `createSignal` call → **state** entry
- `@ai <description>` on a function → **action** entry  
- `@ai-exclude` on an otherwise-tagged item → explicitly skipped (escape hatch)
- No tag → not included (default-exclude, not default-include)

### Store Discovery

Stores are discovered via package.json context annotation, matching the existing pattern:

```jsonc
// packages/app-framework/package.json
{
  "context": {
    "type": "stores",
    "src": "src/frameworks/solid/stores"
  }
}
```

The extractor scans all `.ts`/`.tsx` files in the directory for the `@ai` JSDoc pattern.

### Store Name Detection

Each store file exports a provider/context or has a well-known naming convention. The extractor needs to map `AdamStore.tsx` → `adamStore`. Options (in order of preference):

1. **JSDoc class-level tag:** `/** @ai-store adamStore */` at the top of the file
2. **Filename convention:** `AdamStore.tsx` → camelCase(`Adam`) + `Store` → `adamStore`
3. **Export name detection:** find the `export function createXxxStore()` or `export const XxxContext`

Option 1 is most explicit and resilient. Option 2 works for current naming but is fragile. Recommend option 1 with option 2 as fallback.

```ts
/** @ai-store adamStore */

/** @ai Array of the user's joined spaces */
const [mySpaces, setMySpaces] = createSignal<Space[]>([]);
```

## New Extractor

```
packages/ai-context/src/extractors/stores.ts
```

### Input

A directory of store files (`.ts`/`.tsx`) discovered via `"context": { "type": "stores" }`.

### Output

```ts
interface StoreEntry {
  name: string;              // "adamStore"
  state: string[];           // ["loading", "mySpaces", ...]
  actions: string[];         // ["navigate", "createSpace", ...]
}

interface StoreMetadata {
  entries: StoreEntry[];
  descriptions: Record<string, {
    state: Record<string, string>;    // { mySpaces: "Array of the user's joined spaces" }
    actions: Record<string, string>;  // { createSpace: "(name, description, shared, imageFile?): Creates a new space..." }
  }>;
}
```

### Extraction Logic

1. Use ts-morph to parse each store file
2. Find the `@ai-store <name>` comment → sets the store name
3. Scan all variable declarations and function declarations for `@ai` JSDoc:
   - `createSignal` calls with `@ai` → state (variable name is the signal name, description from JSDoc)
   - Functions with `@ai` → actions (function name + parameters extracted from TypeScript, description from JSDoc)
4. Build type descriptions from TypeScript signatures: `(name: string, description: string, shared: boolean, imageFile?: File)`
5. Return `StoreMetadata`

### Integration with `generate.ts`

Currently:
```ts
// Store entries stay manually authored for now
import { storeEntries, storesFragment } from './fragments/stores';
```

After:
```ts
// Auto-extracted from store source files
const storeMetadata = await extractStores(storePackages);
const storesFragment = generateStoresFragment(storeMetadata);
const storeEntries = storeMetadata.entries;
```

The `stores.ts` fragment file becomes a **generator** that takes `StoreMetadata` and produces the markdown text, rather than being the source of truth for both text and data.

## Changes

### New Files

| File | Purpose |
|------|---------|
| `packages/ai-context/src/extractors/stores.ts` | Store extractor — scans `@ai` JSDoc tags |

### Modified Files

| File | Change |
|------|--------|
| `packages/ai-context/src/generate.ts` | Wire up store extractor, remove manual `storeEntries` import |
| `packages/ai-context/src/fragments/stores.ts` | Convert from data source to generator function. Remove hardcoded `storeEntries`. Keep `generateStoresFragment(metadata)` |
| `packages/app-framework/package.json` | Add `"context": { "type": "stores", "src": "..." }` |
| `packages/app-framework/src/frameworks/solid/stores/AdamStore.tsx` | Add `@ai-store` and `@ai` JSDoc tags |
| `packages/app-framework/src/frameworks/solid/stores/RouteStore.tsx` | Add `@ai` tags |
| `packages/app-framework/src/frameworks/solid/stores/ThemeStore.tsx` | Add `@ai` tags |
| `packages/app-framework/src/frameworks/solid/stores/TemplateStore.tsx` | Add `@ai` tags |
| `packages/app-framework/src/frameworks/solid/stores/SpaceStore.tsx` | Add `@ai` tags |
| `packages/app-framework/src/frameworks/solid/stores/ModalStore.tsx` | Add `@ai` tags |
| `packages/app-framework/src/frameworks/solid/stores/AiStore.tsx` | Add `@ai` tags |

### Deleted (eventually)

| File | Reason |
|------|--------|
| Hardcoded `storeEntries` array in `stores.ts` | Replaced by auto-extraction |
| Hardcoded `descriptions` object in `stores.ts` | Replaced by `@ai` JSDoc descriptions |

## Validation

- [ ] `pnpm --filter @we/ai-context generate-context` produces identical (or improved) store sections in CLAUDE.md / copilot-instructions.md
- [ ] `we-validate-schemas WeTemplate.schema.ts` passes clean (0 errors, 0 warnings)
- [ ] Adding a new `@ai`-tagged function in a store → appears in next `generate-context` run without touching `@we/ai-context`
- [ ] Removing `@ai` tag → method disappears from context
- [ ] Function without `@ai` tag is NOT included
- [ ] `@ai-store` sets the correct store name
- [ ] `pnpm --filter @we/ai-context test` passes

## Sequence

1. Add `@ai-store` and `@ai` JSDoc tags to all store files (no behavior change yet)
2. Build the extractor (`extractors/stores.ts`)
3. Convert `fragments/stores.ts` from data source to generator
4. Wire up in `generate.ts`
5. Verify output matches current context (diff check)
6. Remove hardcoded entries
7. Add extractor tests

## Out of Scope

- **Store discovery via TypeScript analysis** (finding `createContext`/`useContext` patterns automatically). Not needed — explicit `@ai-store` tag is simpler and more reliable.
- **Nested store state** (e.g. `adamStore.me.did`). The current context doesn't support this and it's not needed for schema validation.
- **Automatic public/private classification** without `@ai` tags. Too many heuristics, too fragile. Explicit opt-in is the right model.
- **Reactive computed values** (derived signals, memos). These could be `@ai`-tagged in the future but aren't needed now.
