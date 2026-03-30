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
│5b. Core Blocks │  │5c. $query Service  │  │ 6. Schema           │
│             ✅ │  └────────────────────┘  │    Customization    │
└────────────────┘                          └─────────────────────┘
         │
         ▼
┌────────────────────┐
│5d. Block Persist.  │
│    & Rendering     │
└────────────────────┘
                                                      │
                                                      ▼
                                            ┌─────────────────────┐
                                            │ 4. Local Schema     │
                                            │    State ($local)   │
                                            └─────────────────────┘

                    ┌──────────────────────┐  ┌─────────────────────┐
                    │ 7a. Shared *.types.ts│  │ 7b. Component       │
                    │     Refactor       ✅│  │     Showcase        │
                    └──────────────────────┘  └─────────────────────┘

                    ┌─────────────────────┐
                    │7c. Root Storybook   │
                    │    Migration        │
                    └─────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │ 8. @we/ai-context   │
                    │    Package          │
                    └─────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │8b. Schema Validation│
                    │    (Phase 2)        │
                    └─────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │ 9. MCP Tools        │
                    └─────────────────────┘
```

> **Note:** #5 → #7b dependency (showcase needs clean model imports) is noted in #7b's description but not drawn to avoid crossing arrows. #5b, #5c, and #6 all depend on #5 independently — they can run in parallel. #5d depends on #5b. #6 → #9 dependency is noted in #9's description but not drawn to avoid crossing arrows. #8b has two phases: Phase 1 (token shape checks) has no dependencies; Phase 2 (semantic checks) depends on #8.

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

### 5d. Block Persistence & Rendering

**Plan:** [block-persistence-rendering](../prs/block-persistence-rendering.md)
**Depends on:** Core Block Types (#5b) — models, registry, and factory must exist
**Unblocks:** round-trip block editing (create → save → load → display), `$query` + block display in schema templates

Parent-child linking via polymorphic `@HasMany(() => WeNode, { through: 'we://children' })`, refactored `createBlocks()` with relationship linking, `loadBlocks()` for reconstruction, and display components for all block types. Investigates Ad4mModel polymorphic hydration. Aligns with the CRDT ordering strategy for future ordered collections.

### 5c. `$query` Reactive Query Service

**Plan:** [query-service](../prs/query-service.md)
**Depends on:** Block Model Migration (#5) — model registry imports from `@we/models`
**Unblocks:** declarative data binding in schemas, `$action: "query.*"` mutations, reactive shared data across templates

The keystone of the apps ecosystem. Implements `$query` as a prop-level schema token bound to Ad4mModel subscriptions via SolidJS signals. Includes model registry, query service, `$query` resolver, and `$action` query mutations. ~220 lines of new code.

---

## Phase C: Customization & Storage

### 6. Schema Customization Architecture

**Plan:** [schema-customization-architecture](../prs/schema-customization-architecture.md)
**Depends on:** Block Model Migration (#5) — `SchemaSection` and `TemplateInstall` models go in `@we/models`
**Unblocks:** template gallery, per-section AI editing, section sharing, SHACL auto-generated section tools

The big one. Sectioned storage in AD4M (`SchemaSection` + `TemplateInstall` models), `$section` token, sectionizing algorithm, template gallery, copy-on-activate, section sharing. This is the storage and sharing layer for the entire apps ecosystem.

Also unlocks free SHACL MCP tools for section CRUD — once these AD4M models exist, `schemasection_get`, `schemasection_set_schemajson`, etc. are automatically available.

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

### 7b. Component Showcase

**Plan:** [component-showcase](../prs/component-showcase.md)
**Depends on:** Block Model Migration (#5) — showcase needs clean model imports for block-related components
**Unblocks:** external developer onboarding, component development workflow, visual regression testing

Standalone dev tool (`@we/component-showcase`) for previewing multi-framework components. Can be implemented in parallel with the AI tooling track.

### 7c. Root Storybook Migration

**Plan:** [storybook-migration](../prs/storybook-migration.md)
**Depends on:** nothing (benefits from #10 landing first for more components to verify)
**Unblocks:** cross-package story discovery, SolidJS component stories, unified theme preview

Moves Storybook from `3-primitives/.storybook/` to the monorepo root (`we/.storybook/`). Switches framework to `@storybook/html-vite` so both Lit primitives and SolidJS components render in one instance. Co-locates stories next to their components. Adds `renderSolid()` helper for SolidJS stories. Serves a different audience from #7b (internal team vs. external developers).

### 8. @we/ai-context Package

**Plan:** [ai-context-package](../prs/ai-context-package.md) (PR 2 section)
**Depends on:** Shared `*.types.ts` (#7a)
**Unblocks:** auto-extracted AI context, replacement of hand-written `schemaContext.ts`, MCP tools

Creates `@we/ai-context` with extractors (CEM, TypeScript, tokens, stores), assembler, and hand-maintained fragments for cross-cutting concerns. Exports `schemaContext` constant for runtime and `assembleContext()` for tooling.

### 8b. Schema Validation (Structural → Semantic)

**Plan:** [schema-validation](../prs/schema-validation.md)
**Status:** Phase 1 complete (branch `feat/schema-validation`, 1 commit, 7 files). Phase 2 not started.
**Depends on:** Token shape checks (#8b Phase 1): none. Semantic checks (#8b Phase 2): @we/ai-context (#8) for `ValidationContext`.
**Unblocks:** AI feedback loop — prevents broken schema generation, MCP `validate_schema` tool

Extends existing Zod validation in `packages/schema-system/shared/src/`. Phase 1 adds 11 token shape Zod schemas with structural enforcement, refines `zSchemaProp` union to reject malformed/unknown `$`-operators, adds `superRefine` node-level checks for `$each`/`$if`/`$routes`, adds `severity` field to `ValidationError`, and includes 49 new tests. Also removes stale `schemaUpdater.test.ts` and legacy `solid/src/SchemaRenderer.tsx`. Phase 2 adds a semantic walker that accepts component/store metadata from ai-context to check component existence, prop validity, and store references.

### 9. MCP Tools

**Plan:** [mcp-tools](../prs/mcp-tools.md)
**Depends on:** @we/ai-context (#8) + Schema Validation (#8b) + Schema Customization (#6)
**Unblocks:** on-demand AI component/token/store lookup, schema validation tool, slim orientation prompt

Exposes WE knowledge as MCP tools. Phase 1 (SHACL section tools) is free with #6. Phase 2 (knowledge tools: `list_components`, `get_component`, `validate_schema`, etc.) needs a lightweight WE MCP server backed by `AssembledContext`. The `validate_schema` tool is a thin wrapper around the validation function from #8b.

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
| 2    | 5d  | Block Persistence & Rendering  | Data  | 5b         | Medium | Med  |
| 2    | 5c  | $query Service                 | Data  | 5          | Medium | Med  |
| 2    | 6   | Schema Customization           | Cust  | 5          | Large  | Med  |
| 2    | 7b  | Component Showcase             | AI    | 5          | Medium | Low  |
| 2    | 7c  | Root Storybook Migration       | AI    | —          | S–Med  | Low  |
| 2    | 8   | @we/ai-context                 | AI    | 7a         | Large  | Med  |
| 3    | 4   | Local Schema State             | Cust  | 6          | Medium | Med  |
| 3    | 8b‡ | Schema Validation (semantic)   | AI    | 8          | Small  | Low  |
| 4    | 9   | MCP Tools                      | AI    | 6, 8, 8b   | Large  | Med  |

> **†** 8b structural = token shape Zod schemas (no deps). **‡** 8b semantic = component/store validation (needs ai-context).

---

## Parallelisation Opportunities

Phase A PRs (1–3, 4b, 10) are fully independent — all five can run in parallel. #1b follows #1 sequentially, and #1c follows #1b (same track).

Within Phase B, #5b (Core Block Types), #5c ($query Service), and #6 (Schema Customization) are all independent of each other — they can run in parallel once #5 lands.

Within Phase D, the showcase (#7b) is independent of the AI context track (#7a → #8 → #9) and can run in parallel.

The critical path is: **5 → 6 → 9** (block migration → schema customization → MCP tools), with **7a → 8** feeding into #9 from the AI side. #5c ($query) is the highest-priority ecosystem feature but is off the critical path for tooling PRs — it can be built in parallel with #6. #5b (Core Block Types) and #4 ($localState) are also off the critical path.

```
Time →

Track 1:  [1. Buttons ✅] [1b. Primitives ✅] [1c. Tokens] [3. Themes] [8b-Ph1. Token Validation] ──
Track 2:  [2. Unwrap ✅] [2b. Fine-Grained ✅] [2c. WC Props] ────────────
Track 2b: [4b. $concat] ────────────────────────────────────────────────
Track 2c: [10. Components Ph1] ─────────────────────────────────────────
Track 3:  [5. Models]  [5c. $query] ────────────────────────────────────
Track 4:  ──────────── [5b. Blocks ✅] [5d. Block Persist. & Rendering] ─
Track 5:  ──────────── [6. Schema Customization] ────── [4. $local] ────
Track 6:  [7a. types]  ──────────── [8. ai-context] ─ [8b-Ph2] ─ [9. MCP]
Track 7:  ────────────────────────── [7b. Showcase] ────────────────────
Track 8:  ──────────── [7c. Root Storybook] ────────────────────────────
```
