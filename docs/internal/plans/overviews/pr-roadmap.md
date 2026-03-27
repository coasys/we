# PR Implementation Roadmap

> Strategic ordering of planned PRs. Each PR delivers standalone value while building toward the [WE Apps Ecosystem](we-apps-ecosystem.md) vision.

---

## Dependency Graph

```
                    ┌─────────────────────┐
                    │ 1. Button Variants ✅│
                    └─────────────────────┘
                              │
                    ┌─────────────────────┐
                    │1b. Primitive Pattern │
                    │    Alignment     ✅ │
                    └─────────────────────┘
                              │
                    ┌─────────────────────┐
                    │1c. Token Type        │
                    │    Consolidation  ✅│
                    └─────────────────────┘

                    ┌─────────────────────┐
                    │ 2. Deep Unwrap Props✅│
                    └─────────────────────┘
                              │
                    ┌─────────────────────┐
                    │2b. Fine-Grained   ✅│
                    │    Reactivity        │
                    └─────────────────────┘
                              │
                    ┌─────────────────────┐
                    │2c. Web Component  ✅│
                    │    Prop Unification │
                    └─────────────────────┘

                    ┌─────────────────────┐
                    │ 3. Schema–Theme      │
                    │    Integration       │
                    └─────────────────────┘
                              │
                    ┌─────────────────────┐
                    │3b. color-ui →        │
                    │    color-neutral     │
                    └─────────────────────┘

                    ┌─────────────────────┐
                    │10. Component Library │
                    │    Expansion (Ph 1)  │
                    └─────────────────────┘

                    ┌─────────────────────┐
                    │ 5. Block Model       │
                    │    Migration         │
                    └─────────────────────┘
                      │        │        │
         ┌────────────┘        │        └─────────────┐
         ▼                     ▼                      ▼
┌────────────────┐  ┌────────────────────┐  ┌─────────────────────┐
│5b. Core Blocks   │  │5c. $query Service  │  │ 6. Schema           │
└────────────────┘  └────────────────────┘  │    Customization    │
                                            └─────────────────────┘
                                                      │
                                                      ▼
                                            ┌─────────────────────┐
                                            │ 4. Local Schema      │
                                            │    State ($local)    │
                                            └─────────────────────┘

                    ┌─────────────────────┐  ┌─────────────────────┐
                    │ 7a. Shared *.types.ts│  │ 7b. Component       │
                    │     Refactor        │  │     Showcase        │
                    └─────────────────────┘  └─────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │ 8. @we/ai-context    │
                    │    Package           │
                    └─────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │ 9. MCP Tools         │
                    └─────────────────────┘
```

> **Note:** #5 → #7b dependency (showcase needs clean model imports) is noted in #7b’s description but not drawn to avoid crossing arrows. #5b, #5c, and #6 all depend on #5 independently — they can run in parallel.

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

**Plan:** [primitive-pattern-alignment](../prs/primitive-pattern-alignment.md) | **Summary:** [primitive-pattern-alignment-summary](../prs/primitive-pattern-alignment-summary.md)
**Status:** Complete (branch `feat/primitive-pattern-alignment`, 7 commits, 32 files)
**Depends on:** Button Variants (#1)
**Unblocks:** consistent pattern for Component Library Expansion (#10) — new primitives with variants follow one canonical approach

Migrated badge and text to `DesignSystemElement` with `getInstanceProps()`. Added variant/size systems to input, menu-item, text. Aligned all primitives: consistent `styles` prop type, `inline` styleMap variable, dead code removal. Created `CONVENTIONS.md` contributor guide. Scope grew from single-component migration to full primitives alignment pass.

### 1c. Token Type Consolidation ✅

**Plan:** [token-type-consolidation](../prs/token-type-consolidation.md) | **Summary:** [token-type-consolidation-summary](../prs/token-type-consolidation-summary.md)
**Status:** Complete (branch `feat/token-type-consolidation`, 3 commits, 12 files)
**Depends on:** Primitive Pattern Alignment (#1b) — surfaces the need for `FontWeightToken` in badge defaults
**Unblocks:** consistent token architecture for Component Library Expansion (#10), proper `tokenVar()` lookups for font-weight/line-height/shadow

Moved design-scale types (`FontWeight`, `LineHeight`, `LetterSpacing`, `Shadow`) from `@we/design-types` to `@we/tokens` with proper value maps. Consolidated duplicate `BorderRadiusToken`. Added escape hatch `*Value` types. Created `shadow.ts`, tokens `CONVENTIONS.md`, and `deferred.md` for tracking future work.

### 2. Deep Unwrap Schema Props ✅

**Plan:** [deep-unwrap-schema-props](../prs/deep-unwrap-schema-props.md) | **Summary:** [deep-unwrap-schema-props-summary](../prs/deep-unwrap-schema-props-summary.md)
**Status:** Complete (branch `feat/deep-unwrap-schema-props`, 1 commit, 4 files)
**Depends on:** nothing
**Unblocks:** correct nested reactive prop handling for all components

Added `deepUnwrap` function to SchemaRenderer that recursively unwraps `REACTIVE_ACCESSOR`-marked functions in complex props before distributing to components. Removed manual unwrap workarounds from CollapsibleSidebar and CesiumGlobe. ConditionalRenderer and cesium user-locations correctly left unchanged (different resolution paths).

### 2b. Fine-Grained Schema Reactivity ✅

**Plan:** [fine-grained-schema-reactivity](../prs/fine-grained-schema-reactivity.md) | **Summary:** [fine-grained-schema-reactivity-summary](../prs/fine-grained-schema-reactivity-summary.md)
**Status:** Complete (branch `feat/fine-grained-schema-reactivity`, 2 commits, 2 code files)
**Depends on:** Deep Unwrap (#2) — `deepUnwrap` as a pure function is the foundation
**Unblocks:** performant large templates, per-prop update granularity

Replaces the single-memo-per-component prop resolution with per-prop memos and stable bindings. Store bindings are created once at setup (no memo churn), per-prop memos isolate each prop's dependencies, and static props bypass reactivity entirely. Pure performance optimization — no API or behavioural changes.

### 2c. Web Component Prop Unification ✅

**Plan:** [web-component-prop-unification](../prs/web-component-prop-unification.md) | **Summary:** [web-component-prop-unification-summary](../prs/web-component-prop-unification-summary.md)
**Status:** Complete (branch `feat/web-component-prop-unification`, 1 commit, 3 files)
**Depends on:** Fine-Grained Reactivity (#2b) — per-prop memos are the foundation for per-prop effects
**Unblocks:** cleaner web component prop delivery, removes `DESIGN_SYSTEM_CAMEL_CASE_PROPS` maintenance burden, eliminates ceremony registry wrappers

Unified dual-channel prop delivery into single per-prop effect channel. All web component props delivered via `hostRef[k] = value` property assignment; event handlers stay in JSX spread for Solid's event delegation. Extended component resolution to support hyphenated tag names as fallthrough. Removed 11 ceremony wrapper functions from component registry. Removed `DESIGN_SYSTEM_CAMEL_CASE_PROPS` set.

### 3. Schema–Theme Integration

**Plan:** [schema-theme-integration](../prs/schema-theme-integration.md)
**Depends on:** nothing
**Unblocks:** seed-driven theming, scoped theme zones, dynamic theme registration, theme sections in customization architecture

Bridges the schema/seed layer with the CSS theme system. Defines `ThemeOverrides` type, scoped CSS variable application, seed theme consumption, and runtime theme registration. Currently seeds declare themes but nothing reads them.

### 3b. Rename `color-ui` → `color-neutral`

**Plan:** [neutral-rename](../prs/neutral-rename.md)
**Depends on:** Schema–Theme Integration (#3) — renames fields added in that PR
**Unblocks:** consistent naming before any external consumers adopt the token vocabulary

Renames the `ui` color family to `neutral` across all layers (CSS tokens, JS types, theme files, schema types, component styles). No deprecation — no external consumers exist. Purely mechanical rename with zero logic changes.

### 4b. Add `$concat`, Remove `$expr`

**Plan:** [concat-remove-expr](../prs/concat-remove-expr.md)
**Depends on:** nothing
**Unblocks:** CSP compatibility, schema validation coverage, safer token set

Removes `$expr` (arbitrary JS via `new Function()`) entirely — no external consumers exist. Adds `$concat` for safe string building. Migrates all 11 `$expr` uses in internal templates to `$concat`, `$if`, or direct `$forEach` context references. Net token count unchanged (−1 `$expr`, +1 `$concat`).

### 10. Core Component Library Expansion (Phase 1)

**Plan:** [component-library-expansion](../prs/component-library-expansion.md)
**Depends on:** nothing
**Unblocks:** schema-first app viability — without Select, Textarea, Table, Grid, Card, etc., most app archetypes hit missing-component walls

Phase 1 adds ~10 P0 components: Select, Textarea, Checkbox, Radio, FormField, Grid, Card, Table, List, Toast. These are the minimum set for schema-first apps to cover basic archetypes (todo list, form-based apps, data tables, dashboards). FormField is critical for `$validate` integration. Phase 2/3 components land incrementally as templates demand them.

---

## Phase B: Data Architecture

### 5. Block Model Migration

**Plan:** [block-model-migration](../prs/block-model-migration.md)
**Depends on:** nothing (but strategically placed here as prerequisite for Phases B and C)
**Unblocks:** `$query` service, AI context extraction, clean model imports, core block types

Moves TextBlock, ImageBlock, CollectionBlock from `@we/block-system` to `@we/models`. Small mechanical refactor that decouples model definitions from the Lexical block composer.

### 5b. Core Block Types

**Plan:** [core-block-types](../prs/core-block-types.md)
**Depends on:** Block Model Migration (#5) — new models go in `@we/models`
**Unblocks:** richer `$query` data, semantic block rendering outside editor, template diversity

Expands block model set from 3 to 13. Adds AudioBlock, VideoBlock, FileBlock, EventBlock, TaskBlock, LocationBlock, LinkBlock, CodeBlock, TagBlock, EmbedBlock. Each model has semantic fields readable by any app via `$query`, plus an editor component registered via `registerBlock()` (uses GenericBlockNode — no per-block Lexical code).

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

### 7a. Shared `*.types.ts` Refactor

**Plan:** [ai-context-package](../prs/ai-context-package.md) (PR 1 section)
**Depends on:** nothing (but strategically placed here — its value is realised by #8)
**Unblocks:** @we/ai-context auto-extraction, multi-framework component support

Extract shared prop interfaces from framework-specific files into `*.types.ts`. Add `@ai` JSDoc to components with non-obvious contracts. Pure mechanical refactor — no behaviour changes.

### 7b. Component Showcase

**Plan:** [component-showcase](../prs/component-showcase.md)
**Depends on:** Block Model Migration (#5) — showcase needs clean model imports for block-related components
**Unblocks:** external developer onboarding, component development workflow, visual regression testing

Standalone dev tool (`@we/component-showcase`) for previewing multi-framework components. Can be implemented in parallel with the AI tooling track.

### 8. @we/ai-context Package

**Plan:** [ai-context-package](../prs/ai-context-package.md) (PR 2 section)
**Depends on:** Shared `*.types.ts` (#7a)
**Unblocks:** auto-extracted AI context, replacement of hand-written `schemaContext.ts`, MCP tools

Creates `@we/ai-context` with extractors (CEM, TypeScript, tokens, stores), assembler, and hand-maintained fragments for cross-cutting concerns. Exports `schemaContext` constant for runtime and `assembleContext()` for tooling.

### 8b. Schema Validation (Structural → Semantic)

**Plan:** [schema-validation](../prs/schema-validation.md)
**Depends on:** Token shape checks (#8b Phase 1): none. Semantic checks (#8b Phase 2): @we/ai-context (#8) for `ValidationContext`.
**Unblocks:** AI feedback loop — prevents broken schema generation, MCP `validate_schema` tool

Extends existing Zod validation in `packages/schema-system/shared/src/`. Phase 1 adds token shape Zod schemas (validates `$if` has `condition`/`then`, `$forEach` has `items`/child template, etc.) — no dependencies, can land early in Phase A. Phase 2 adds a semantic walker that accepts component/store metadata from ai-context to check component existence, prop validity, and store references.

### 9. MCP Tools

**Plan:** [mcp-tools](../prs/mcp-tools.md)
**Depends on:** @we/ai-context (#8) + Schema Validation (#8b) + Schema Customization (#6)
**Unblocks:** on-demand AI component/token/store lookup, schema validation tool, slim orientation prompt

Exposes WE knowledge as MCP tools. Phase 1 (SHACL section tools) is free with #6. Phase 2 (knowledge tools: `list_components`, `get_component`, `validate_schema`, etc.) needs a lightweight WE MCP server backed by `AssembledContext`. The `validate_schema` tool is a thin wrapper around the validation function from #8b.

---

## Summary Table

| #   | PR                             | Phase | Depends on       | Size   | Risk |
| --- | ------------------------------ | ----- | ---------------- | ------ | ---- |
| 1   | Button Variants ✅             | A     | —                | Small  | Low  |
| 1b  | Primitive Pattern Alignment ✅ | A     | 1                | Small  | Low  |
| 1c  | Token Type Consolidation  ✅   | A     | 1b               | S–Med  | Low  |
| 2   | Deep Unwrap Props ✅           | A     | —                | Small  | Low  |
| 2b  | Fine-Grained Reactivity ✅     | A     | 2                | Medium | Med  |
| 2c  | Web Component Prop Unify ✅    | A     | 2b               | Small  | Low  |
| 3   | Schema–Theme Integration       | A     | —                | Medium | Low  |
| 4   | Local Schema State             | C     | 6                | Medium | Med  |
| 4b  | $concat + remove $expr         | A     | —                | Small  | Low  |
| 5   | Block Model Migration          | B     | —                | Small  | Low  |
| 5b  | Core Block Types               | B     | 5                | Medium | Low  |
| 5c  | $query Service                 | B     | 5                | Medium | Med  |
| 6   | Schema Customization           | C     | 5                | Large  | Med  |
| 7a  | Shared \*.types.ts             | D     | —                | Medium | Low  |
| 7b  | Component Showcase             | D     | 5                | Medium | Low  |
| 8   | @we/ai-context                 | D     | 7a               | Large  | Med  |
| 8b  | Schema Validation              | A→D   | — (Ph1), 8 (Ph2) | Small  | Low  |
| 9   | MCP Tools                      | D     | 6, 8, 8b         | Large  | Med  |
| 10  | Component Library (Phase 1)    | A     | —                | Medium | Low  |

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
Track 4:  ──────────── [5b. Blocks] ────────────────────────────────────
Track 5:  ──────────── [6. Schema Customization] ────── [4. $local] ────
Track 6:  [7a. types]  ──────────── [8. ai-context] ─ [8b-Ph2] ─ [9. MCP]
Track 7:  ────────────────────────── [7b. Showcase] ────────────────────
```
