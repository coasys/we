# Plan: Schema Validation — Phase 2 (Semantic Checks)

## Problem

Phase 1 added structural validation via Zod — token shapes, node shapes, and `superRefine` checks for `$each`/`$if`/`$routes`. But structural validation can't catch the most common schema authoring errors:

- **Unknown components** — `{ "type": "we-buttn" }` passes Zod (it's a valid string) but will render nothing at runtime
- **Invalid props** — `{ "type": "we-button", "props": { "colour": "red" } }` passes Zod but `colour` isn't a real prop
- **Wrong prop value types** — `fontSize: 42` (number) instead of `fontSize: "600"` (string token)
- **Unknown store references** — `{ "$store": "userStore.name" }` passes structurally but `userStore` doesn't exist
- **Unknown model references** — `{ "$query": { "model": "Taks" } }` — typo passes Zod but fails at runtime
- **Non-existent store actions** — `{ "$action": "routeStore.goTo" }` — `goTo` doesn't exist on `routeStore`
- **Undefined $local fields** — `{ "$local": "nme" }` when `$localState` declares `"name"` — silent undefined at runtime
- **Route structure errors** — routes array without `$routes` outlet, duplicate paths

These are the errors AI agents produce most frequently. Without semantic validation, the feedback loop is: generate → render → visually broken → manually debug. With it: generate → validate → specific error message → fix.

## Proposal

Add a `validateSemantic()` function that walks the schema tree checking every node and prop reference against known components, props, stores, models, `$localState` scope, and route structure. Returns `ValidationError[]` with `severity: 'error' | 'warning'`.

The existing `validateSchema()` is renamed to `validateStructure()` to clarify its scope. `validateSchema()` becomes the composed entry point: structural first, then semantic if structural passes.

This PR touches two packages: `@we/ai-context` (extend `AssembledContext` with structured data for primitives and stores) and `@we/schema-system-shared` (the validator itself).

### New function signatures

```ts
import type { AssembledContext } from '@we/ai-context';
import type { StoreEntry } from '@we/ai-context';
import type { ValidationResult } from './validators';

/** Context for semantic validation — derived from AssembledContext + store data */
export type ValidationContext = {
  /** All known component type names (tag names + component names) */
  componentNames: Set<string>;
  /** Map from component name → set of valid prop names (own + DS props for that component's layer) */
  componentProps: Map<string, Set<string>>;
  /** Map from component name → map of prop name → type category ('string' | 'boolean' | 'number' | 'unknown') */
  componentPropTypes: Map<string, Map<string, string>>;
  /** Set of props valid on every component (event handlers, styles, etc.) */
  universalProps: Set<string>;
  /** All known store names (top-level keys) */
  storeNames: Set<string>;
  /** Map from store name → set of known properties and methods */
  storeMembers: Map<string, Set<string>>;
  /** All known model class names (for $query) */
  modelNames: Set<string>;
  /** Map from DS prop name → layer it belongs to (for diagnostic messages) */
  dsPropToLayer: Map<string, string>;
};

/** Build ValidationContext from AssembledContext + store entries */
export function buildValidationContext(assembled: AssembledContext, stores: StoreEntry[]): ValidationContext;

/** Structural validation only (Zod) — renamed from validateSchema */
export function validateStructure(schema: unknown): ValidationResult;

/** Walk a schema tree and check semantic correctness */
export function validateSemantic(schema: unknown, context: ValidationContext): ValidationResult;

/** Full validation: structural (Zod) + semantic — the default entry point */
export function validateSchema(schema: unknown, context: ValidationContext): ValidationResult;
```

### What gets checked

| Check                                | Severity | Example error                                                                                                         |
| ------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------- |
| Unknown component type               | error    | `Unknown component "we-buttn". Did you mean "we-button"?`                                                             |
| Unknown prop on known component      | warning  | `Unknown prop "colour" on "we-button"` (or, if it's a DS prop from a missing layer: `"bg" requires the visual layer`) |
| Prop type category mismatch          | warning  | `Prop "disabled" on "we-button" expects boolean, got string`                                                          |
| Unknown store reference              | error    | `Unknown store "userStore" in $store token. Known stores: adamStore, routeStore, ...`                                 |
| Unknown store member                 | warning  | `Unknown member "goTo" on store "routeStore". Known members: navigate, currentPath, ...`                              |
| Unknown model in $query              | error    | `Unknown model "Taks" in $query. Did you mean "TaskBlock"?`                                                           |
| $each missing `as` prop              | warning  | `$each without "as" prop — children can't reference item context`                                                     |
| $action on unknown store             | error    | `Unknown store "foo" in $action "foo.bar"`                                                                            |
| $action unknown method               | warning  | `Unknown method "bar" on store "foo". Known actions: ...`                                                             |
| Unknown $local field                 | error    | `$local references "nme" but $localState only declares: name, email`                                                  |
| Unknown $error/$valid/$touched field | error    | `$error references "nme" but $localState only declares: name, email`                                                  |
| $local without $localState in scope  | error    | `$local references "name" but no $localState is declared in scope`                                                    |
| Duplicate route paths                | warning  | `Duplicate route path "/settings" at routes[1] and routes[3]`                                                         |
| Routes without $routes outlet        | warning  | `Node has "routes" array but no { type: "$routes" } in children`                                                      |
| $routes without routes array         | warning  | `{ type: "$routes" } found but no "routes" array on any ancestor`                                                     |

**Severity rationale:**

- **error** for references that will definitely break at runtime (unknown component, store, model, undefined $local field)
- **warning** for references that _might_ work or are structural issues but not crashes (unknown prop, type mismatch, route structure)

### What stays out of scope

- **Enum/token value validation** — checking that `variant: "primry"` isn't a valid `ButtonVariant`, or that `fontSize: "999"` isn't a valid size token. The CEM stores type info as reference names (`"ButtonVariant"`) not expanded unions, so resolving valid values requires deep type resolution. Deferred.
- **Nested token type propagation** — verifying that `$if.then` returns a type compatible with the prop it's assigned to. Would require building a mini type-checker across token boundaries. Deferred.

## Design decisions

### Include data in `AssembledContext`, not just extend it

The current `AssembledContext` is missing two things the validator needs:

1. **Primitive superclass** — to compute DS prop layers
2. **Structured store data** — to validate store/action references without parsing prose

Rather than having the validator read raw sources or bolt on a parallel data path, we include this data properly in `AssembledContext`. The question for each piece is: does it also help the AI (consumer 1), or just the validator (consumer 2)?

**Superclass: include on `PrimitiveEntry` AND in text output.** The AI currently has no way to know which DS props are valid on which primitive — it sees `ownProps` but not the layer classification. This means it generates `bg` on `we-icon` (a `LayoutElement`) and nothing happens at runtime. Adding superclass to the text output costs ~30 tokens total (one word per primitive) and lets the AI reason about prop validity _at generation time_ — prevention rather than detection. So this goes on `PrimitiveEntry` and into the assembled text.

**Stores: structured data exported separately, not a new field on `AssembledContext`.** The text fragment already works well for AI context — no reason to change it. But the validator needs structured data. Rather than adding `stores: StoreEntry[]` to `AssembledContext` (which changes the shape for all consumers), the stores fragment file exports a `storeEntries: StoreEntry[]` array alongside the text. The text is generated from the array (single source of truth). The validator imports `storeEntries` directly from `@we/ai-context`. `AssembledContext` stays unchanged for stores — `fragments.stores` remains a string.

```ts
// Superclass added to PrimitiveEntry
export interface PrimitiveEntry {
  tagName: string;
  className: string;
  description?: string;
  superclass?: string;          // ← NEW: e.g. "DesignSystemElement", "LayoutElement"
  ownProps: PropEntry[];
}

// Exported from ai-context/src/fragments/stores.ts (not on AssembledContext)
export interface StoreEntry {
  name: string;                 // e.g. "adamStore", "routeStore"
  state: string[];              // property names: ["loading", "adamClient", "me", "mySpaces"]
  actions: string[];            // method names: ["navigate", "addNewSpace"]
}

// AssembledContext shape unchanged for stores
export interface AssembledContext {
  primitives: PrimitiveEntry[];  // primitives now include superclass
  components: ComponentEntry[];
  models: ModelEntry[];
  tokens: TokenCategory[];
  fragments: { ... };            // fragments.stores stays a string
}
```

**Benefits:**

- `superclass` in `PrimitiveEntry` helps both AI context (prevention) and validation (detection)
- Superclass in text output costs ~30 tokens but prevents an entire class of generation errors
- `buildValidationContext()` stays a pure function — takes `AssembledContext` + `storeEntries`
- Tests can build context inline — no filesystem access
- `AssembledContext` shape only changes in one way (`superclass` on existing type), no new top-level fields
- Store text is generated from structured data (single source of truth) but consumers see no change
- `extractPrimitives()` gets a one-line extension (read `superclass.name` from CEM)

### Component name matching

Schema `type` values map to components in several ways:

- **Primitives:** hyphenated tag names like `we-button`, `we-text`
- **SolidJS components:** PascalCase names like `Column`, `Row`, `Table`, `Dialog`
- **Operator nodes:** `$each`, `$if`, `$routes` — skipped
- **Native HTML elements:** `div`, `span`, `h1`, etc. — always valid, skipped

The validator skips nodes where `type` starts with `$` (operators) or matches a known set of ~50 common HTML tag names. Unknown types are checked against the component registry.

### "Did you mean?" suggestions

For unknown component names and model names, Levenshtein distance against known names; suggest the closest match if distance ≤ 3.

### Design system prop validation

`buildValidationContext()` merges each component's own props with its DS props into a single `componentProps` entry. The prop check is one lookup: "is this prop in the set?"

For primitives (from CEM), the DS prop set is computed from `superclass` → `BASE_CLASS_LAYERS` → `getKeysForLayers()`:

| Base class                      | Layers                                  |
| ------------------------------- | --------------------------------------- |
| `DesignSystemElement`           | layout, visual, flex, typography, state |
| `OverlayElement`                | layout, visual, flex, typography, state |
| `LayoutElement`                 | layout                                  |
| `LayoutTypographyElement`       | layout, typography                      |
| `LayoutVisualElement`           | layout, visual                          |
| `LayoutVisualTypographyElement` | layout, visual, typography              |

For SolidJS components and widgets (from `*.types.ts`), the prop set is whatever the TypeScript interface declares — no DS inheritance.

If an unknown prop is a known DS prop from a layer the component doesn't support, the error message names the missing layer. A `dsPropToLayer` reverse-map enables this diagnostic.

Universal props (`styles`, `on*` event handlers) are valid on all components.

### Prop type category checking

The CEM and TypeScript extractors provide `type.text` for each prop. While we can't resolve type aliases to their union values (e.g. `ButtonVariant` → `'primary' | 'secondary' | ...`), we can extract the **type category**: `'string'`, `'boolean'`, `'number'`, or `'unknown'`. Rules:

- `type.text === 'boolean'` → category `'boolean'`
- `type.text === 'string'` or `type.text` includes `'string'` in a union → category `'string'`
- `type.text === 'number'` → category `'number'`
- Named types like `ButtonVariant`, `SpaceValue` → category `'string'` (they're all string-based enums)
- Everything else → `'unknown'` (skip check)

When a static prop value's JS type doesn't match the category, emit a warning. Token objects (`$store`, `$if`, etc.) skip this check — their runtime type depends on resolution.

### Structured store data

The stores fragment is currently a hand-maintained template literal string. This PR restructures the source of truth:

1. Define `storeEntries: StoreEntry[]` as structured data in the stores fragment file
2. Generate the text string from the structured data (so `fragments.stores` stays identical)
3. Export `storeEntries` from `@we/ai-context` for the validator to import directly

`AssembledContext.fragments.stores` continues to be a string — no shape change for AI context consumers. The validator imports `storeEntries` separately. This means the hand-maintained data is structured (7 stores, changes infrequently), the text output is derived, and the validator gets clean data without parsing.

### $localState scope tracking

The tree walker maintains a **scope stack** of declared `$localState` field names. At each node:

1. If `$localState` is present, push its declared field names onto the scope (merged with parent, matching runtime behaviour)
2. When encountering `$local`, `$setLocal`, `$error`, `$valid`, `$touched`, or `$touch` tokens, check the referenced field name against the current scope
3. Skip special values: `$touch: "$all"`, `$formValid: "$scope"`, `$resetLocal: "$scope"`
4. If no `$localState` is in scope at all, error: "no $localState declared in scope"
5. If `$localState` exists but the field name isn't declared, error with the list of declared fields

This catches the most common AI error: typos in field names (`"nme"` instead of `"name"`).

### Route validation

Three checks added to the tree walker:

1. **Duplicate paths** — at each node with a `routes` array, check for duplicate `path` values at the same level. Warning.
2. **Routes without outlet** — if a node has a `routes` array, check that somewhere in its `children` (recursively) there's a `{ type: "$routes" }` node. Warning.
3. **Orphaned outlet** — if a `{ type: "$routes" }` node exists, check that some ancestor has a `routes` array. Warning.

### Composing structural + semantic

`validateSchema()` runs structural validation first. If the schema fails structural checks, semantic validation is skipped — no point checking component names on a malformed tree.

```ts
export function validateSchema(schema: unknown, context: ValidationContext): ValidationResult {
  const structural = validateStructure(schema);
  if (!structural.valid) return structural;
  const semantic = validateSemantic(schema, context);
  return {
    valid: semantic.errors.filter((e) => e.severity === 'error').length === 0,
    errors: [...structural.errors, ...semantic.errors],
  };
}
```

A schema with only warnings is `valid: true`.

## Usage examples

### Programmatic (in tests or scripts)

```ts
import { assembleContext } from '@we/ai-context';
import { storeEntries } from '@we/ai-context';
import { buildValidationContext, validateSchema } from '@we/schema-system-shared';

const ctx = buildValidationContext(assembleContext(), storeEntries);
const result = validateSchema(mySchema, ctx);

if (!result.valid) {
  for (const err of result.errors) {
    console.log(`[${err.severity}] ${err.path}: ${err.message}`);
  }
}
```

### Example output

```
[error] children[0].type: Unknown component "we-buttn". Did you mean "we-button"?
[warning] children[1].props.colour: Unknown prop "colour" on "we-text"
[warning] children[1].props.disabled: Prop "disabled" on "we-button" expects boolean, got string
[error] children[2].props.onClick.$action: Unknown store "userStore" in $action "userStore.save"
[error] children[3].props.items.$query.model: Unknown model "Taks" in $query. Did you mean "TaskBlock"?
[error] children[4].props.value.$local: $local references "nme" but $localState only declares: name, email
[warning] routes: Duplicate route path "/settings" at routes[1] and routes[3]
```

## Implementation

### ai-context changes

| File                                          | Changes                                                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `ai-context/src/types.ts`                     | Add `superclass?: string` to `PrimitiveEntry`; add `StoreEntry` type (exported separately, not on `AssembledContext`) |
| `ai-context/src/extractors/cem.ts`            | Read `superclass.name` from CEM declarations into `PrimitiveEntry.superclass`                                         |
| `ai-context/src/fragments/stores.ts`          | Restructure: export `storeEntries: StoreEntry[]` as structured data; derive text string from it; export both          |
| `ai-context/src/assembler.ts`                 | Use generated text for `fragments.stores` (no shape change to `AssembledContext`)                                     |
| `ai-context/src/schemaContext.ts`             | Include `superclass` in per-primitive text output (e.g. `"we-button (DesignSystemElement)"`)                          |
| `ai-context/src/__tests__/ai-context.test.ts` | Update tests for `superclass` field; test store text generation matches current output                                |

### schema-system changes

| File                                                    | Changes                                                                                                                                                                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema-system/shared/src/semanticValidation.ts`        | **New.** `ValidationContext` type, `buildValidationContext()`, `validateSemantic()`, `validateSchema()` (composed), tree walker, scope tracker, route checker, Levenshtein helper, HTML element set, `BASE_CLASS_LAYERS` + `LAYER_KEYS` constants |
| `schema-system/shared/tests/semanticValidation.test.ts` | **New.** Unit tests for all semantic checks                                                                                                                                                                                                       |
| `schema-system/shared/src/index.ts`                     | Re-export `validateSchema` from `semanticValidation.ts` (replaces old export), export `validateStructure`, `validateSemantic`, `buildValidationContext`, `ValidationContext`                                                                      |
| `schema-system/shared/src/validators.ts`                | Rename `validateSchema` → `validateStructure`, `validateNode` → `validateNodeStructure`                                                                                                                                                           |
| `schema-system/shared/tests/validators.test.ts`         | Update renamed function references                                                                                                                                                                                                                |
| `schema-system/frameworks/solid/src/schemaUpdater.ts`   | Update import: `validateSchema` → `validateStructure`                                                                                                                                                                                             |
| `schema-system/shared/package.json`                     | Add `@we/ai-context` as `devDependency` (for `AssembledContext` type + `storeEntries` import)                                                                                                                                                     |

### Rename: `validateSchema` → `validateStructure`

| Before             | After                     | Purpose                                  |
| ------------------ | ------------------------- | ---------------------------------------- |
| `validateSchema()` | `validateStructure()`     | Zod structural checks only               |
| `validateNode()`   | `validateNodeStructure()` | Single-node Zod checks                   |
| _(new)_            | `validateSemantic()`      | Component/store/model/scope/route checks |
| _(new)_            | `validateSchema()`        | Composed: structure + semantic           |

**Migration scope (1 consumer):**

- `schemaUpdater.ts` — update import to `validateStructure` (it only needs structural checks for real-time editing)
- `validators.test.ts` — rename test references

### Implementation order

1. **ai-context: extend types** — `superclass` on `PrimitiveEntry`, `StoreEntry` type (exported separately)
2. **ai-context: CEM extractor** — read `superclass.name`
3. **ai-context: stores restructure** — structured `storeEntries` array, generate text from it, export both
4. **ai-context: text output** — include `superclass` in primitive text; use generated store text in assembler
5. **schema-system: `semanticValidation.ts`** — types, `buildValidationContext(assembled, storeEntries)`, Levenshtein, HTML set, `BASE_CLASS_LAYERS`/`LAYER_KEYS`
6. **Tree walker** — recursive `walkNode()` with scope stack, route tracking, prop checks
7. **Rename** — `validateSchema` → `validateStructure` in `validators.ts`; update imports
8. **`validateSchema()`** — composed structural + semantic
9. **Exports** — wire into `index.ts`
10. **Tests** — comprehensive coverage

### Test plan

| Category                 | Tests                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildValidationContext` | Builds component set from primitives + components; merges DS props per layer; builds store map from `storeEntries`; builds model set; builds prop type map                                                                                                                                                                    |
| Unknown component        | Error for unknown type; passes for known primitive; passes for known component; skips `$each`/`$if`/`$routes`; skips native HTML elements                                                                                                                                                                                     |
| Did-you-mean             | Suggests close matches (distance ≤ 3); no suggestion for distant names                                                                                                                                                                                                                                                        |
| Unknown prop             | Warning for unknown prop on known component; passes for known own prop; passes for valid DS prop on full-DS primitive; warns for DS prop from unsupported layer with helpful message; works for primitives, components, and widgets; skips unknown components (already errored); `styles` and `on*` always valid              |
| Prop type mismatch       | Warning for string where boolean expected; warning for number where string expected; skips token objects; skips `'unknown'` categories                                                                                                                                                                                        |
| Unknown store            | Error for `$store` with unknown store name; passes for known store                                                                                                                                                                                                                                                            |
| Unknown store member     | Warning for unknown member path; passes for known member                                                                                                                                                                                                                                                                      |
| Unknown action store     | Error for `$action` with unknown store                                                                                                                                                                                                                                                                                        |
| Unknown action method    | Warning for `$action` with unknown method on known store                                                                                                                                                                                                                                                                      |
| Unknown model            | Error for `$query.model` with unknown model name; did-you-mean suggestion                                                                                                                                                                                                                                                     |
| $local scope             | Error for `$local` referencing undeclared field; error for `$local` with no `$localState` in scope; passes for declared field; works with nested `$localState` (merged scope); same checks for `$error`, `$valid`, `$touched`, `$touch`, `$setLocal`; skips `$touch: "$all"`, `$formValid: "$scope"`, `$resetLocal: "$scope"` |
| Route validation         | Warning for duplicate paths; warning for routes without `$routes` outlet; warning for orphaned `$routes`                                                                                                                                                                                                                      |
| Nested detection         | Finds tokens inside `$if.condition`, `$if.then`, `$concat` items, `$map.select` values                                                                                                                                                                                                                                        |
| Deep tree                | Validates children, slots, routes recursively                                                                                                                                                                                                                                                                                 |
| Composed validation      | `validateSchema` skips semantic on structural failure; returns combined errors                                                                                                                                                                                                                                                |
| Severity                 | Errors make result invalid; warnings don't                                                                                                                                                                                                                                                                                    |

Target: ~55 tests.

## Resolved questions

1. **Should unknown props be errors or warnings?** — **Warnings.** With DS props validated per-component, false positives are rare. But web components can accept arbitrary attributes, so we keep it as a warning.

2. **Should we validate DS props per component?** — **Yes.** CEM `superclass` → `BASE_CLASS_LAYERS` → `getKeysForLayers()` gives exact per-component DS prop sets. The error message names the specific missing layer.

3. **Should we include basic prop type checking?** — **Yes, type categories only.** We check `string` vs `boolean` vs `number` mismatches. We don't validate enum values (`ButtonVariant`), token values (`SpaceValue`), or token resolution types. The CEM has type info (`"boolean"`, `"string | undefined"`, `"ButtonVariant"`); named types are classified as their base category (all current enums are string-based).

4. **Should we include $local field validation?** — **Yes.** The walker already recurses — maintaining a scope stack is straightforward. Typos in field names are probably the #1 AI error after unknown components. The scope tracks merged `$localState` fields (matching runtime behaviour). Special values (`"$all"`, `"$scope"`) are skipped.

5. **Should we include route validation?** — **Yes.** Three simple tree checks (duplicates, missing outlet, orphaned outlet). Catches real bugs, minimal implementation cost.

6. **Should stores be structured data?** — **Yes, but exported separately from `AssembledContext`.** The stores fragment is restructured: `storeEntries: StoreEntry[]` is the source of truth, the text string is generated from it. But `stores` doesn't become a top-level field on `AssembledContext` — `fragments.stores` stays a string. The validator imports `storeEntries` directly from `@we/ai-context`. This avoids changing the `AssembledContext` shape for all consumers while giving the validator clean structured data.

7. **Should we extend `PrimitiveEntry` with `superclass`?** — **Yes, and include it in the text output too.** The `superclass` field goes on `PrimitiveEntry` for validation, AND into the assembled text output (~30 extra tokens total). This lets the AI reason about which DS props are valid _during generation_ — prevention is strictly better than detection. The text output shows e.g. `"we-button (DesignSystemElement)"` next to each primitive.

8. **How to handle the `styles` prop?** — **Always valid.** `styles` and `on*` event handlers go in `universalProps`.

9. **Native HTML element list** — **Conservative set of ~50.** Unknown lowercase-no-hyphen tags get a warning, not an error.

10. **What still stays out?** — **Enum/token value validation** (needs type resolution) and **nested token type propagation** (needs a mini type-checker). Both are genuinely complex with diminishing returns — the type category check catches the most common mistakes (passing a number where a string is expected) without the complexity.
