# PR Implementation Roadmap

> Strategic ordering of planned PRs. Each PR delivers standalone value while building toward the [WE Apps Ecosystem](we-apps-ecosystem.md) vision.

---

## Dependency Graph

```
                    ┌──────────────────────┐
                    │ 1. Button Variants ✅│
                    └──────────────────────┘
                              │
                    ┌─────────────────────┐
                    │1b. Primitive Pattern│
                    │    Alignment      ✅│
                    └─────────────────────┘
                              │
                    ┌─────────────────────┐
                    │1c. Token Type       │
                    │    Consolidation  ✅│
                    └─────────────────────┘

                    ┌───────────────────────┐
                    │ 2. Deep Unwrap Props✅│
                    └───────────────────────┘
                              │
                    ┌─────────────────────┐
                    │2b. Fine-Grained   ✅│
                    │    Reactivity       │
                    └─────────────────────┘
                              │
                    ┌─────────────────────┐
                    │2c. Web Component  ✅│
                    │    Prop Unification │
                    └─────────────────────┘

                    ┌─────────────────────┐
                    │ 3. Schema–Theme   ✅│
                    │    Integration      │
                    └─────────────────────┘
                              │
                    ┌─────────────────────┐
                    │3b. color-ui →     ✅│
                    │    color-neutral    │
                    └─────────────────────┘

                    ┌─────────────────────┐
                    │4b. $concat, remove✅│
                    │    $expr            │
                    └─────────────────────┘

                    ┌─────────────────────┐
                    │8b. Schema Validation│
                    │    (Phase 1)      ✅│
                    └─────────────────────┘

                    ┌─────────────────────┐
                    │10. Component        │
                    │    Library        ✅│
                    └─────────────────────┘

                    ┌─────────────────────┐
                    │ 5. Block Model      │
                    │    Migration      ✅│
                    └─────────────────────┘
                      │        │        │
         ┌────────────┘        │        └─────────────┐
         ▼                     ▼                      ▼
┌────────────────┐  ┌────────────────────┐  ┌─────────────────────┐
│5b. Core Blocks │  │5c. $query        ✅│  │ 6. Schema           │
│             ✅ │  └────────────────────┘  │    Customization  ✅│
└────────────────┘                          └─────────────────────┘
         │
         ▼
┌────────────────────┐
│5d. Block Persist.  │
│    & Rendering   ✅│
└────────────────────┘
                                                      │
                                                      ▼
                                            ┌─────────────────────┐
                                            │ 4. Local Schema     │
                                            │    State ($local)   │
                                            └─────────────────────┘

                    ┌──────────────────────┐  ┌─────────────────────┐
                    │ 7a. Shared *.types.ts│  │ 7b. Component       │
                    │     Refactor       ✅│  │     Showcase     ⏸️ │
                    └──────────────────────┘  └─────────────────────┘

                    ┌─────────────────────┐
                    │7c. Root Storybook   │
                    │    Migration     ⏸️ │
                    └─────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │ 8. @we/ai-context   │
                    │    → Skills Output  │
                    └─────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │8b. Schema Validation│
                    │    (Phase 2)        │
                    └─────────────────────┘

                    ┌─────────────────────┐
                    │ 9. MCP Tools     ⏸️ │
                    │    (deferred)       │
                    └─────────────────────┘
```

> **Note:** #5b, #5c, and #6 all depend on #5 independently — they can run in parallel. #5d depends on #5b. #8b has two phases: Phase 1 (token shape checks) has no dependencies; Phase 2 (semantic checks) depends on #8. #9 is deferred indefinitely — skills/instruction files achieve the same AI context delivery without MCP infrastructure. #7b and #7c are deferred as developer tooling that doesn't advance the core vision.

---

## Phase A: Schema System Foundations

Fix existing gaps in the schema system. PRs 1–3 and 4b are independent of each other and can be parallelised.

### 1. Button Variants ✅

**Plan:** [button-variants](../prs/button-variants.md)
**Status:** Merged to dev
**Depends on:** nothing
**Unblocks:** cleaner schema templates, less manual `bg`/`color` boilerplate

Adds `variant` prop (`primary`, `secondary`, `ghost`, `danger`, `outline`) to `we-button`. Pure design system change — small, self-contained, immediately improves every schema template.

### 1b. Primitive Pattern Alignment ✅

**Plan:** [primitive-pattern-alignment](../prs/primitive-pattern-alignment.md)
**Status:** Complete (branch `feat/primitive-pattern-alignment`, 7 commits, 32 files)
**Depends on:** Button Variants (#1)
**Unblocks:** consistent pattern for Component Library Expansion (#10) — new primitives with variants follow one canonical approach

Migrated badge and text to `DesignSystemElement` with `getInstanceProps()`. Added variant/size systems to input, menu-item, text. Aligned all primitives: consistent `styles` prop type, `inline` styleMap variable, dead code removal. Created `CONVENTIONS.md` contributor guide. Scope grew from single-component migration to full primitives alignment pass.

### 1c. Token Type Consolidation ✅

**Plan:** [token-type-consolidation](../prs/token-type-consolidation.md)
**Status:** Complete (branch `feat/token-type-consolidation`, 3 commits, 12 files)
**Depends on:** Primitive Pattern Alignment (#1b) — surfaces the need for `FontWeightToken` in badge defaults
**Unblocks:** consistent token architecture for Component Library Expansion (#10), proper `tokenVar()` lookups for font-weight/line-height/shadow

Moved design-scale types (`FontWeight`, `LineHeight`, `LetterSpacing`, `Shadow`) from `@we/design-types` to `@we/tokens` with proper value maps. Consolidated duplicate `BorderRadiusToken`. Added escape hatch `*Value` types. Created `shadow.ts`, tokens `CONVENTIONS.md`, and `deferred.md` for tracking future work.

### 2. Deep Unwrap Schema Props ✅

**Plan:** [deep-unwrap-schema-props](../prs/deep-unwrap-schema-props.md)
**Status:** Complete (branch `feat/deep-unwrap-schema-props`, 1 commit, 4 files)
**Depends on:** nothing
**Unblocks:** correct nested reactive prop handling for all components

Added `deepUnwrap` function to SchemaRenderer that recursively unwraps `REACTIVE_ACCESSOR`-marked functions in complex props before distributing to components. Removed manual unwrap workarounds from CollapsibleSidebar and CesiumGlobe. ConditionalRenderer and cesium user-locations correctly left unchanged (different resolution paths).

### 2b. Fine-Grained Schema Reactivity ✅

**Plan:** [fine-grained-schema-reactivity](../prs/fine-grained-schema-reactivity.md)
**Status:** Complete (branch `feat/fine-grained-schema-reactivity`, 2 commits, 2 code files)
**Depends on:** Deep Unwrap (#2) — `deepUnwrap` as a pure function is the foundation
**Unblocks:** performant large templates, per-prop update granularity

Replaces the single-memo-per-component prop resolution with per-prop memos and stable bindings. Store bindings are created once at setup (no memo churn), per-prop memos isolate each prop's dependencies, and static props bypass reactivity entirely. Pure performance optimization — no API or behavioural changes.

### 2c. Web Component Prop Unification ✅

**Plan:** [web-component-prop-unification](../prs/web-component-prop-unification.md)
**Status:** Complete (branch `feat/web-component-prop-unification`, 1 commit, 3 files)
**Depends on:** Fine-Grained Reactivity (#2b) — per-prop memos are the foundation for per-prop effects
**Unblocks:** cleaner web component prop delivery, removes `DESIGN_SYSTEM_CAMEL_CASE_PROPS` maintenance burden, eliminates ceremony registry wrappers

Unified dual-channel prop delivery into single per-prop effect channel. All web component props delivered via `hostRef[k] = value` property assignment; event handlers stay in JSX spread for Solid's event delegation. Extended component resolution to support hyphenated tag names as fallthrough. Removed 11 ceremony wrapper functions from component registry. Removed `DESIGN_SYSTEM_CAMEL_CASE_PROPS` set.

### 3. Schema–Theme Integration ✅

**Plan:** [schema-theme-integration](../prs/schema-theme-integration.md)
**Status:** Complete (branch `feat/schema-theme-integration`, 2 commits, 22 files)
**Depends on:** nothing
**Unblocks:** seed-driven theming, scoped theme zones, dynamic theme registration, theme sections in customization architecture

Bridges the schema/seed layer with the CSS theme system. Added `ThemeOverrides` type with Zod validation, `themeToStyle()` converter, scoped CSS variable application via `display: contents` wrappers in SchemaRenderer. Fixed `isRawCSSValue()` for `var()` passthrough, `tokenVar` font-size prefix, theme CSS issues. Added `gradient` prop to `we-button` (primary variant, `::before` overlay). Standardised all `we-text` props to `fontSize`/`fontWeight`. Created theme `CONVENTIONS.md`.

### 3b. Rename `color-ui` → `color-neutral` ✅

**Plan:** [neutral-rename](../prs/neutral-rename.md)
**Status:** Complete (branch `feat/neutral-rename`, 1 commit, 57 files)
**Depends on:** Schema–Theme Integration (#3) — renames fields added in that PR
**Unblocks:** consistent naming before any external consumers adopt the token vocabulary

Renamed the `ui` color family to `neutral` across all layers: JS tokens (`ColorHueToken`, `colorConfig`), CSS generation, 5 theme files, schema types (`ThemeOverrides`, Zod), `themeStyles.ts`, all component defaults (`'ui-NNN'` → `'neutral-NNN'`), templates, Solid components, prompt context, and documentation. Purely mechanical rename — zero logic changes.

### 4b. Add `$concat`, Extend `$item`, Rename `$forEach` → `$each`, Remove `$expr` ✅

**Plan:** [concat-remove-expr](../prs/concat-remove-expr.md)
**Status:** Complete (branch `feat/concat-remove-expr`, 1 commit, 19 files)
**Depends on:** nothing
**Unblocks:** CSP compatibility, schema validation coverage, safer token set, unified `$item.*` context access

Removed `$expr` (arbitrary JS via `new Function()`) entirely — no external consumers exist. Added `$concat` for safe string building. Extended `$item.*` string resolution from `$map`-only to the dispatcher, so `$each` children access items via `$item.name` instead of `{ $expr: 'item.name' }`. Renamed `$forEach` → `$each` to match the single-word naming convention of all other tokens. Generalised to `$<contextKey>.*` for nested `$each` with custom `as` bindings. Migrated all 11 `$expr` uses to `$item.*`, `$concat`, or `$if`. Added schema system `CONVENTIONS.md`. Fixed `isStaticValue()` to treat `$`-prefixed strings as non-static. Net token count unchanged (−1 `$expr`, +1 `$concat`); `$item.*` is a dispatcher resolution rule, not a new token type.

### 10. Core Component Library Expansion ✅

**Plan:** [component-library-expansion](../prs/component-library-expansion.md)
**Status:** Complete (branch `feat/component-library-expansion`, 2 commits, 71 files)
**Depends on:** nothing
**Unblocks:** schema-first app viability — without Select, Textarea, Table, Grid, Card, etc., most app archetypes hit missing-component walls

Added 34 components (25 Lit primitives + 9 SolidJS components) bringing the total to 42 registered primitives. Phase 1: FormField, Textarea, Checkbox, Radio, Select, Card, Grid (Lit) + List, Table, Toast (SolidJS). Stripped Input of label/error chrome; migrated 9 usages to FormField wrapping. Phase 2: Switch, Divider, Tag, ProgressBar, Alert, Skeleton, Link, Code, Blockquote, NumberInput, Slider, Drawer, ScrollArea, Pagination, Combobox, DatePicker, FileUpload, ColorPicker (Lit) + Dialog, Breadcrumbs, Accordion, Stepper, Timeline, Calendar (SolidJS). Added `fontFamily` DS prop across the full pipeline (tokens → types → utils → primitives → components). Moved SolidJS component styles from inline to SCSS with BEM classes. Also created #7c Storybook migration plan.

---

## Phase B: Data Architecture

### 5. Block Model Migration ✅

**Plan:** [block-model-migration](../prs/block-model-migration.md)
**Status:** Complete (branch `feat/block-model-migration`, 1 commit, 12 files)
**Depends on:** nothing (but strategically placed here as prerequisite for Phases B and C)
**Unblocks:** `$query` service, AI context extraction, clean model imports, core block types

Moved TextBlock, ImageBlock, CollectionBlock from `@we/block-system/shared/src/models/` to `@we/models/src/blocks/`. Updated imports in serialization, AdamStore, SpaceStore, CreateSpaceModal. Re-exported from `@we/block-shared` for back-compat. Editor infrastructure (registry, GenericBlockNode) deferred to #5b.

### 5b. Core Block Types ✅

**Plan:** [core-block-types](../prs/core-block-types.md)
**Status:** Complete (branch `feat/core-block-types`, 4 commits, 24 files)
**Depends on:** Block Model Migration (#5) — new models go in `@we/models`
**Unblocks:** block persistence & rendering (#5d), richer `$query` data, semantic block rendering outside editor, template diversity

Expanded block model set from 3 to 15. Added 12 new models: AudioBlock, VideoBlock, FileBlock, EventBlock, TaskBlock, LocationBlock, LinkBlock, CodeBlock, TagBlock, EmbedBlock, CalloutBlock, DividerBlock. Created block type registry (`registerBlock`/`getBlockModel`) with idempotent `registerCoreBlocks()`. Refactored serialization from hardcoded if-branches to registry-based using `getPropertiesMetadata()` + `ModelClass.create()`. Added `createBlockNodeClass` factory for generic Lexical DecoratorNode creation. Migrated existing models to simplified URI convention (`we://field_name`), removed blanket `required: true`, removed `type` field from ImageBlock/CollectionBlock, added `columns`/`gap` to CollectionBlock. Renamed CSS class `we-block-composer-block` → `we-block`.

### 5d. Block Persistence & Rendering ✅

**Plan:** [block-persistence-rendering](../prs/block-persistence-rendering.md)
**Status:** Complete (branch `feat/block-persistence-rendering`, 1 commit, 11 code files)
**Depends on:** Core Block Types (#5b) — models, registry, and factory must exist
**Unblocks:** round-trip block editing (create → save → load → display), `$query` + block display in schema templates

Implements parent-child linking via `@HasMany({ through: 'we://children' })` on CollectionBlock (string-only, manual hydration — Ad4mModel doesn't support polymorphic `@HasMany`). Refactored `createBlocks()` with `Ad4mModel.transaction()` and recursive parent-child linking. Added `loadBlocks()` for tree reconstruction via block registry type resolution. Extended `BlockRegistration` with `display`/`input` component fields. Extended `createBlockNodeClass` factory with `BlockBridge` component (Lexical coupling, display/input switching, `onChange`/`isSelected` props). Added `BlockDisplayOverrides` context for consumer display overrides. Split ImageBlock into `ImageDisplay` (pure) + `ImageInput` (with `onChange`). Created `registerCoreBlockComponents()` entry point. Filed AD4M feature request for `polymorphic: true` on `@HasMany`.

### 5c. `$query` Reactive Query Service ✅

**Plan:** [query-service](../prs/query-service.md)
**Status:** Complete (branch `feat/query-service`, 4 commits, 17 files)
**Depends on:** Block Model Migration (#5) — model registry imports from `@we/models`
**Unblocks:** declarative data binding in schemas, `$action: "model.*"` mutations, reactive shared data across templates

Implements `$query` as a prop-level schema token with descriptor pattern (shared resolver returns pure `QueryDescriptor`, framework layer handles subscription lifecycle). Read side: `QueryToken` type + `zQueryToken` Zod schema, `resolveQueryProp` shared resolver, SchemaRenderer `$query` handling with `createSignal` + `createEffect` + `onCleanup`. Write side: `modelRegistry` (`registerModel`/`getModel`), `modelStore` in TemplateProvider (create/update/delete), `$getModel` passed to SchemaRenderer stores. Also refactored `processArgTokens` to recursive for nested `$arg` tokens. 8 integration tests covering subscribe lifecycle, perspective reactivity, cleanup, one-shot mode, params forwarding, and graceful fallback. Fixed pre-existing ImageBlock barrel import in block-system.

---

## Phase C: Customization & Storage

### 6. Schema Customization Architecture ✅

**Plan:** [schema-customization-architecture](../prs/schema-customization-architecture.md) | [review](../prs/schema-customization-review.md)
**Decision:** [template-storage-architecture](../../../decisions/template-storage-architecture.md)
**Status:** Complete (branch `feat/schema-customization`, 5 commits, 12 files)
**Depends on:** Block Model Migration (#5) — `Template` model goes in `@we/models`
**Unblocks:** template gallery, per-section AI editing, section sharing, SHACL auto-generated section tools

**Architecture pivot:** Original plan called for physically split `SchemaSection` models with `$section` tokens. Review identified section drift, naming fragility, and structural rigidity issues. Pivoted to **monolith + stored index** — single `StoredTemplate` blob (schema + pre-computed section index) stored in AD4M via file-storage language. Index is generated at creation and structural edits, travels with shared copies for cross-client consistency.

`Template` AD4M model with file-storage backed schema property. Tree-walk section indexer (`computeSectionIndex`, `extractByPath`, `patchByPath`). Section API (`createStoredTemplate`, `getSection`, `updateSection`). TemplateStore rewritten to use AD4M perspective instead of localStorage. 30 tests. Decision document comparing three approaches.

### 4. Local Schema State (`$localState`)

**Plan:** [local-schema-state](../prs/local-schema-state.md)
**Depends on:** Schema Customization (#6) — `$localState` is most valuable when AI can generate schema-only forms within sections
**Unblocks:** schema-only forms (Create Space, settings pages), reduces need for one-off SolidJS components

Adds `$localState` / `$local` / `$setLocal` tokens for ephemeral form state scoped to a schema node's lifecycle. Deferred from Phase A as a Tier 2 token — most forms can remain SolidJS components until sections exist.

---

## Phase D: AI Tooling

### 7a. Shared `*.types.ts` Refactor ✅

**Plan:** [shared-types-refactor](../prs/shared-types-refactor.md)
**Status:** Complete (branch `feat/shared-types-refactor`, 1 commit, 84 files)
**Depends on:** nothing (but strategically placed here — its value is realised by #8)
**Unblocks:** @we/ai-context auto-extraction, multi-framework component support

Extracted shared prop interfaces from 13 `.solid.tsx` files into co-located `*.types.ts` files across 4-components and 5-widgets. Moved `solid/` → `frameworks/solid/` in all four packages (4-components, 5-widgets, block-system, schema-system). Refactored 3 components from `Accessor<T>` to plain props and simplified SchemaRenderer by removing the accessor passthrough branch. Added `@ai` JSDoc to 5 non-obvious components. Established `export type *` (TS 5.0+) re-export pattern and `extends` for Solid-specific slot props. Created design-system `CONVENTIONS.md`.

### 7b. Component Showcase ⏸️

**Plan:** [component-showcase](../prs/component-showcase.md)
**Status:** Deferred — developer tooling, not vision-critical. Revisit when external contributor onboarding becomes a priority.
**Depends on:** Block Model Migration (#5) — showcase needs clean model imports for block-related components
**Unblocks:** external developer onboarding, component development workflow, visual regression testing

Standalone dev tool (`@we/component-showcase`) for previewing multi-framework components. Deferred because it doesn't advance the core app-building workflow.

### 7c. Root Storybook Migration ⏸️

**Plan:** [storybook-migration](../prs/storybook-migration.md)
**Status:** Deferred — internal developer tooling, not vision-critical.
**Depends on:** nothing (benefits from #10 landing first for more components to verify)
**Unblocks:** cross-package story discovery, SolidJS component stories, unified theme preview

Moves Storybook from `3-primitives/.storybook/` to the monorepo root (`we/.storybook/`). Switches framework to `@storybook/html-vite` so both Lit primitives and SolidJS components render in one instance. Co-locates stories next to their components. Adds `renderSolid()` helper for SolidJS stories. Serves a different audience from #7b (internal team vs. external developers). Deferred because it doesn't block any remaining work.

### 8. @we/ai-context Package

**Plan:** [ai-context-package](../prs/ai-context-package.md) (PR 2 section)
**Depends on:** Shared `*.types.ts` (#7a)
**Unblocks:** auto-extracted AI context, replacement of hand-written `schemaContext.ts`, VS Code skill/instruction files for local AI agents

Creates `@we/ai-context` with extractors (CEM, TypeScript, tokens, stores), assembler, and hand-maintained fragments for cross-cutting concerns. Exports `schemaContext` constant for runtime and `assembleContext()` for tooling.

**Output target pivot:** Original plan targeted MCP tool responses. Now targets VS Code skill files (`.instructions.md`) and Copilot custom instructions (`copilot-instructions.md`). The assembled context is written to instruction files that are version-controlled with the repo, so any local AI agent (Copilot, Cursor, etc.) automatically has full component/token/convention knowledge without requiring an MCP server. The `assembleContext()` function and extractors are unchanged — only the delivery mechanism is different.

**AI integration strategy (progressive):**
1. **Phase 1 (now):** Local agents — users clone the repo, Copilot/Cursor builds schemas with skill files providing context. Zero infrastructure.
2. **Phase 2 (later):** Cloud API from within WE app — users provide their own API key, section API + assembled context become the system prompt for in-app "AI edits this section" UI.
3. **Phase 3 (aspirational):** AD4M built-in AI — deferred until local models have sufficient context windows (20K+ effective context needed for schema context alone).

### 8b. Schema Validation (Structural → Semantic)

**Plan:** [schema-validation](../prs/schema-validation.md)
**Status:** Phase 1 complete (branch `feat/schema-validation`, 1 commit, 7 files). Phase 2 not started.
**Depends on:** Token shape checks (#8b Phase 1): none. Semantic checks (#8b Phase 2): @we/ai-context (#8) for `ValidationContext`.
**Unblocks:** AI feedback loop — prevents broken schema generation, local `validate` function callable from terminal or test scripts

Extends existing Zod validation in `packages/schema-system/shared/src/`. Phase 1 adds 11 token shape Zod schemas with structural enforcement, refines `zSchemaProp` union to reject malformed/unknown `$`-operators, adds `superRefine` node-level checks for `$each`/`$if`/`$routes`, adds `severity` field to `ValidationError`, and includes 49 new tests. Also removes stale `schemaUpdater.test.ts` and legacy `solid/src/SchemaRenderer.tsx`. Phase 2 adds a semantic walker that accepts component/store metadata from ai-context to check component existence, prop validity, and store references. Local agents can invoke validation via terminal (`npx vitest` or direct function call) — no MCP wrapper needed.

### 9. MCP Tools ⏸️

**Plan:** [mcp-tools](../prs/mcp-tools.md)
**Status:** Deferred indefinitely — VS Code skills/instruction files achieve equivalent AI context delivery without MCP infrastructure.
**Depends on:** @we/ai-context (#8) + Schema Validation (#8b) + Schema Customization (#6)
**Unblocks:** on-demand AI component/token/store lookup, schema validation tool, slim orientation prompt

Exposes WE knowledge as MCP tools. Phase 1 (SHACL section tools) is free with #6. Phase 2 (knowledge tools: `list_components`, `get_component`, `validate_schema`, etc.) needs a lightweight WE MCP server backed by `AssembledContext`. The `validate_schema` tool is a thin wrapper around the validation function from #8b.

**Why deferred:** With 200K+ context windows on modern models, the component/token/convention reference fits comfortably in skill files — no on-demand lookup needed. Schema validation can be invoked locally via terminal. The only genuinely dynamic tool (SHACL section tools) is free with #6 and doesn't need the full MCP server. If MCP is ever needed, the hard part (assembling context via #8) is done — building the server is straightforward.

---

## Summary Table

> Ordered by **execution wave** — all items within a wave are independent and can run in parallel. "Theme" groups PRs by topic (Schema, Data, Customization, AI tooling); it doesn't imply ordering.

| Wave | #   | PR                             | Theme | Depends on | Size   | Risk |
| ---- | --- | ------------------------------ | ----- | ---------- | ------ | ---- |
| ✅   | 1   | Button Variants                | Sch   | —          | Small  | Low  |
| ✅   | 1b  | Primitive Pattern Alignment    | Sch   | 1          | Small  | Low  |
| ✅   | 1c  | Token Type Consolidation       | Sch   | 1b         | S–Med  | Low  |
| ✅   | 2   | Deep Unwrap Props              | Sch   | —          | Small  | Low  |
| ✅   | 2b  | Fine-Grained Reactivity        | Sch   | 2          | Medium | Med  |
| ✅   | 2c  | Web Component Prop Unify       | Sch   | 2b         | Small  | Low  |
| ✅   | 3   | Schema–Theme Integration       | Sch   | —          | Medium | Low  |
| ✅   | 3b  | color-ui → color-neutral       | Sch   | 3          | Small  | Low  |
| ✅   | 4b  | $concat + remove $expr         | Sch   | —          | Small  | Low  |
| ✅   | 5   | Block Model Migration          | Data  | —          | Small  | Low  |
| ✅   | 7a  | Shared \*.types.ts             | AI    | —          | Medium | Low  |
| ✅   | 8b† | Schema Validation (structural) | Sch   | —          | Small  | Low  |
| ✅   | 10  | Component Library Expansion    | Sch   | —          | Large  | Low  |
| ✅   | 5b  | Core Block Types               | Data  | 5          | Medium | Low  |
| ✅   | 5d  | Block Persistence & Rendering  | Data  | 5b         | Medium | Med  |
| ✅   | 5c  | $query Service                 | Data  | 5          | Medium | Med  |
| ✅   | 6   | Schema Customization           | Cust  | 5          | Large  | Med  |
| 2    | 8   | @we/ai-context → Skills        | AI    | 7a         | Large  | Med  |
| 2    | 4   | Local Schema State             | Cust  | 6          | Medium | Med  |
| 3    | 8b‡ | Schema Validation (semantic)   | AI    | 8          | Small  | Low  |
| ⏸️   | 7b  | Component Showcase             | AI    | 5          | Medium | Low  |
| ⏸️   | 7c  | Root Storybook Migration       | AI    | —          | S–Med  | Low  |
| ⏸️   | 9   | MCP Tools                      | AI    | 6, 8, 8b   | Large  | Med  |

> **†** 8b structural = token shape Zod schemas (no deps). **‡** 8b semantic = component/store validation (needs ai-context). **⏸️** = deferred indefinitely (developer tooling or superseded by skills approach).

---

## Parallelisation Opportunities

Phase A PRs (1–3, 4b, 10) are fully independent — all five can run in parallel. #1b follows #1 sequentially, and #1c follows #1b (same track).

Within Phase B, #5b (Core Block Types), #5c ($query Service), and #6 (Schema Customization) are all independent of each other — they can run in parallel once #5 lands.

**Remaining work:** #8 (ai-context → skills) and #4 ($localState) are fully independent and can run in parallel. #8b‡ (semantic validation) follows #8. #7b, #7c, and #9 are deferred.

The critical path for the complete schema-first app-building workflow is: **#8 (ai-context → skills) + #4 ($localState)** in parallel, then **#8b‡ (semantic validation)** as an optional follow-up. This gives local AI agents full component/token context via instruction files, and unlocks schema-only forms.

```
Time →

Track 1:  [1–3, 4b, 10 ✅] ──────────────────────────────────────────────────
          [5 → 5b/5c/5d/6 ✅] ───────────────────────────────────────────────
          [7a ✅] ────────────────────────────────────────────────────────────
          [8b-Ph1 ✅] ────────────────────────────────────────────────────────

Track 2:  [8. ai-context → skills] ── [8b-Ph2. semantic]              ← next wave
Track 3:  [4. $localState] ────────────────────────────────            ← next wave (parallel with #8)

Deferred: [7b. Showcase ⏸️] [7c. Storybook ⏸️] [9. MCP Tools ⏸️]
```
