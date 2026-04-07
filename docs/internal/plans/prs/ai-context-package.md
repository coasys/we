# Plan: `@we/ai-context` — Auto-Extracted Context for Local AI Agents

> Replaces the hand-written `schemaContext.ts` with auto-extraction from source. Primary output: committed instruction files for local AI agents (Copilot, Cursor, etc.) + runtime constant for in-app AI.

---

## Problem

`schemaContext.ts` is a hand-written ~400-line string in `app-framework` that documents components, tokens, stores, and operators for AI schema generation. Problems:

1. **Wrong home** — runtime and tooling concerns are mixed
2. **Drifts from source** — no enforcement mechanism; manually maintained. Currently lists 6 primitives when 42 exist, references removed tokens (`$expr`, `$forEach`), and is missing `$concat`, `$not`, `$ne`, `$and`, `$or`, variants, theme overrides, all 34 components from PR #10, and all 15 block models from `@we/models`.
3. **Single consumer assumed** — any future tooling must depend on `app-framework`
4. **No local agent support** — no `.instructions.md` or skill files in the repo; developers cloning the repo get zero AI context automatically

---

## Strategy: Two Layers

```
Layer 1 (Now):    Auto-extract from source + JSDoc conventions
Layer 2 (Now):    Assemble into instruction files + runtime constant
```

Both layers ship in one PR. The data model (`ComponentEntry`, `StoreEntry`, `TokenSet`) is structured enough that if MCP is ever needed in the future, it's a straightforward extension — but MCP is not a design target.

---

## Layer 1 — Auto-Extraction from Source

### What gets extracted automatically

| Source                           | What we get                    | How                                                                  |
| -------------------------------- | ------------------------------ | -------------------------------------------------------------------- |
| `@we/primitives` web components  | Props + types                  | Custom Elements Manifest (CEM) — already configured                  |
| `@we/components` + `@we/widgets` | Props + types                  | Parse `*.types.ts` files (framework-agnostic shared prop interfaces) |
| `@we/design-system/1-tokens`     | All token values               | Read token objects directly (they're typed TS exports)               |
| `@we/models` block + entity types | Model names, fields, types, relations | Parse `@Model`/`@Property`/`@HasMany`/`@HasOne` decorators with ts-morph |

**Block/entity models are auto-extracted.** `@we/models` contains 15 block types (TextBlock, ImageBlock, AudioBlock, CollectionBlock, etc.) and 4 entity models (Space, Template, Theme, AgentConfig), all decorated with `@Model`/`@Property`/`@HasMany`. The extractor reads decorator metadata to produce model name + field name/type/required/default pairs, plus relation declarations (`@HasMany`/`@HasOne` with their `through` predicate and target model). Relations are critical for `$query` — they define the `include` and `parent` parameters (e.g. CollectionBlock `@HasMany({ through: 'we://children' })`, WeNode `@HasMany({ through: 'we://has_comments' })`). Models change frequently as the block ecosystem grows (3 → 15 already, targeting 20+), making auto-extraction essential.

**Stores are hand-maintained in fragments**, not auto-extracted. There are only 7 stores, they change infrequently, and they're Solid.js-specific (`Accessor<T>`, `createSignal`) — parsing them requires unwrapping framework wrappers for minimal benefit. The store section in `fragments/stores.ts` documents state keys and action signatures in plain text.

### JSDoc convention — only where needed

Most components are self-describing from their name and prop types alone. JSDoc is only added when a component has non-obvious contracts:

- **Option shapes** — e.g. PopoverMenu expects `{ id, name, icon }[]`; TypeScript says `object[]`
- **Schema-only vs programmatic-only** — intent that TypeScript can't express (e.g. `CesiumGlobe` can't be schema-rendered)
- **Store coupling** — e.g. "use `$map` to derive this prop from `templateStore.templates`"
- **Slot conventions** — non-obvious named slots

Convention: a `@ai` JSDoc tag on the component's shared types file (`*.types.ts`). The `@ai` tag describes the component's contract, not its framework-specific rendering. Example:

```typescript
// PopoverMenu/PopoverMenu.types.ts

/**
 * @ai Dropdown menu for selecting one option.
 * Options must have shape `{ id: string; name: string; icon: string }[]`.
 * Use $map to derive options and selectedOption from store data — see stores section.
 * Pattern: options from templateStore.templates, selectedOption from templateStore.currentTemplate.
 */
export interface PopoverMenuProps {
  options: { id: string; name: string; icon: string }[];
  selectedOption: { id: string; name: string; icon: string };
  onSelect: (option: { id: string; name: string; icon: string }) => void;
}
```

Note: shared types are **framework-agnostic** — no `Accessor<T>`, `Signal<T>`, or `JSX.Element`. Each framework implementation adapts the shared types as needed (e.g. Solid wraps in `Accessor`, React uses as-is).

The extraction script reads `@ai` tags and includes them as the component's description. No `@ai` tag = description is inferred from component name.

### What stays hand-maintained

Cross-cutting concerns that don't live in any single component file, and change rarely:

- **Schema operators** (`$store`, `$if`, `$map`, `$each`, `$query`, etc.) — these are system-level, not per-component
- **Routing patterns** — route arrays, path syntax, `$routes` outlet
- **Store state & actions** — 7 stores with their state keys and action signatures (AdamStore, RouteStore, ThemeStore, TemplateStore, SpaceStore, ModalStore, AiStore)
- **Store usage patterns** — how to wire components to stores idiomatically
- **Rules + constraints** — "never use null in children arrays", "meta is required at root", etc.

These live in `packages/ai-context/src/fragments/` as before. They're architectural documentation that changes infrequently and earns its maintenance cost.

### Principle: only document implemented features

Fragments and extractors document what **currently works in the codebase**, not what's planned. When `$localState` lands, the schema-operators fragment gets updated. When `$validate` lands, same. If an AI generates a schema using a token that doesn't exist yet, the schema won't render — that's worse than the AI not knowing about it. The instruction files are a snapshot of current capabilities, not a roadmap.

---

## Layer 2 — Assembly Package

### New package: `packages/ai-context/`

Same structure as the previous plan, but the assembler now reads from extracted data rather than per-package hand-written files:

```
packages/ai-context/
├── package.json              (@we/ai-context)
├── tsconfig.json
├── tsup.config.ts
├── README.md
└── src/
    ├── index.ts
    ├── types.ts              # Shared types: ComponentEntry, ModelEntry, StoreEntry, TokenSet, etc.
    ├── assembler.ts          # Composes all sources into AssembledContext
    ├── generate.ts           # CLI script: assembles context → writes output files
    ├── extractors/
    │   ├── cem.ts            # Reads CEM output for @we/primitives
    │   ├── typescript.ts     # Parses *.types.ts interfaces for components + widgets
    │   ├── tokens.ts         # Reads @we/design-tokens token objects
    │   └── models.ts         # Parses @Model/@Property/@HasMany/@HasOne from @we/models
    └── fragments/            # Hand-maintained (cross-cutting concerns only)
        ├── schema-operators.ts
        ├── routing.ts
        ├── stores.ts         # All 7 stores: state keys + action signatures
        ├── store-patterns.ts
        └── rules.ts
```

**No per-package `ai-context.ts` files.** The extractors read the actual source directly. Block/entity models are auto-extracted from `@we/models` (they use standard `@Model`/`@Property`/`@HasMany`/`@HasOne` decorators that ts-morph handles cleanly). Stores are hand-maintained in fragments (not extracted) because there are only 7, they change rarely, and parsing Solid.js-specific type wrappers isn't worth the complexity.

### Three kinds of output

`@we/ai-context` serves three audiences:

**1. Committed instruction files** (for local AI agents — primary output):

The `generate.ts` script writes assembled context to instruction files that are **committed to source control**:

```
we/.github/copilot-instructions.md     # GitHub Copilot custom instructions
we/.instructions.md                    # VS Code Copilot instructions (workspace-level)
```

These files are version-controlled so that anyone cloning the repo immediately gets full AI context. They are regenerated by running `pnpm run generate-context` from the `@we/ai-context` package.

**2. Pre-built runtime constant** (for in-app AI like `AiStore.handleSchemaPrompt()`):

```typescript
// Pre-computed string, baked into dist/ at build time
export const schemaContext: string;
```

During `@we/ai-context`'s build step, the build script calls `assembleReference()` and writes the result as a string constant into the package's built output. Runtime consumers import this constant — they never run extractors themselves.

**3. Build-time functions** (for tooling and testing):

```typescript
// Run extractors → return structured object
assembleContext(): AssembledContext

// Run extractors → return LLM-ready reference string (facts only, no framing)
assembleReference(): string
```

These call extractors, parse source files, and do real work. They require access to the source tree.

### Design principle: content vs. framing

`assembleReference()` returns the **factual reference content only** — component catalogue, token reference, operator docs, model fields, store signatures, rules. No preamble, no instructions for how to use the information.

Each **output target adds its own framing** appropriate to its audience:

- **Instruction files** (`generate.ts`): wraps the reference with a codebase-orientation header — "This workspace uses a schema-driven UI system. Here are the available components, tokens, and conventions..."
- **Runtime prompt** (`AiStore.handleSchemaPrompt()`): wraps the imported `schemaContext` constant with a task-specific system prompt — "Generate a valid WE schema using only these components. Output well-formed JSON..."

This separation keeps prompt-engineering decisions out of the extraction layer. The extraction layer produces facts; consumers add intent. If a third consumer appears (e.g. a validation error message generator), it wraps the same reference with its own framing.

### How it works end-to-end

```
pnpm run generate-context (from @we/ai-context):
  1. extractors parse source files (CEM JSON, *.types.ts, token objects, @Model decorators)
  2. assembler merges extracted data + hand-maintained fragments
  3. assembleReference() produces the factual reference string
  4. generate.ts wraps with instruction-file framing and writes to:
     a. .github/copilot-instructions.md  (committed, for local agents)
     b. .instructions.md                 (committed, for VS Code)

@we/ai-context build step (turbo):
  1. same extraction + assembly
  2. reference string written as `export const schemaContext = "..."` in dist/
     (consumers wrap with their own framing at runtime)

Runtime (app-framework):
  import { schemaContext } from '@we/ai-context';   // just a string
```

The instruction files are committed to source control and should be regenerated whenever components, tokens, stores, or operators change. The runtime constant in `dist/` is gitignored like any other build artifact.

### Regeneration workflow

```bash
# After modifying components, tokens, stores, or operators:
cd packages/ai-context
pnpm run generate-context

# Review the diff, then commit:
git add ../../.github/copilot-instructions.md ../../.instructions.md
git commit -m "chore: regenerate AI context"
```

CI can optionally verify that instruction files are up-to-date by running `generate-context` and checking for uncommitted diffs. This is a guard rail, not a blocker — add it when drift becomes a problem.

If extraction turns out to be slow, a lightweight cache (hash input files, skip re-extraction if unchanged) can be added. Wait to see if this is actually needed.

---

## Future Possibility: MCP Tools

If MCP is ever needed (e.g. for agents with smaller context windows, or for a cloud-hosted WE editing experience), the `AssembledContext` object is already structured data that can feed tool handlers directly. Building an MCP server on top of `assembleContext()` would be straightforward — the hard part (extraction + assembly) is done. This is noted here for context but is **not a design target** for this PR.

See [mcp-tools.md](mcp-tools.md) for the deferred MCP plan.

---

## Prerequisite: Shared `*.types.ts` Files ✅

> **Status:** Complete (PR #7a — branch `feat/shared-types-refactor`, 1 commit, 84 files).

Extracted shared prop interfaces from 13 `.solid.tsx` files into co-located `*.types.ts` files. 20+ shared type files now exist across `4-components` and `5-widgets`. 5 components have `@ai` JSDoc tags (PopoverMenu, PopoverToggleMenu, CesiumGlobe, GraphWidget, CollapsibleSidebar). All follow the framework-agnostic pattern (no `Accessor<T>`, `Signal<T>`, `JSX.Element`).

---

## Migration: Existing `schemaContext.ts`

The hand-written file is the reference for quality. Steps:

1. Run extractors against current codebase — compare output to hand-written
2. For any components where auto-extracted docs are thin, add `@ai` JSDoc to the source
3. Port the cross-cutting content (operators, routing, rules) to `fragments/`
4. Run extraction — verify output is equivalent or better
5. Delete `schemaContext.ts`; replace its import with `import { schemaContext } from '@we/ai-context'`

---

## PR Scope

Two PRs. PR 1 is already complete. PR 2 is the implementation.

### PR 1: Shared `*.types.ts` refactor ✅

Complete — see PR #7a in the [roadmap](../overviews/pr-roadmap.md).

### PR 2: `@we/ai-context` package + instruction files + migration

Depends on PR 1 (complete). Creates the extraction + assembly package, generates instruction files, and replaces the hand-written `schemaContext.ts`.

- [ ] Create `packages/ai-context/` with types, extractors, assembler, fragments, generate script
- [ ] Implement CEM extractor for `@we/primitives` (reads `custom-elements.json`)
- [ ] Implement TypeScript extractor for `*.types.ts` in `@we/components` + `@we/widgets`
- [ ] Implement token extractor for `@we/design-system/1-tokens`
- [ ] Implement model extractor for `@we/models` (parses `@Model`/`@Property`/`@HasMany`/`@HasOne` decorators)
- [ ] Write hand-maintained fragments (operators, routing, stores, store patterns, rules)
- [ ] Write `generate.ts` script that outputs:
  - `.github/copilot-instructions.md` (committed)
  - `.instructions.md` (committed)
  - `dist/schemaContext` constant (build artifact)
- [ ] Wire `@we/ai-context` build into turbo dependency graph
- [ ] Replace `schemaContext.ts` import with `import { schemaContext } from '@we/ai-context'`
- [ ] Validate extracted output against hand-written reference (snapshot test for section presence)
- [ ] Add `@ai` JSDoc to additional components where extracted docs are thin
- [ ] Run `generate-context`, commit instruction files
- [ ] Update `docs/architecture/overview.md`

---

## Open Questions

1. **TypeScript parser choice** — **decided: `ts-morph`.** Even "simple" interface parsing is verbose with the raw TS compiler API (manual AST walking, `SyntaxKind` checks, JSDoc tag extraction). ts-morph makes property/type/JSDoc extraction concise and debuggable. It's a dev-only dependency (never shipped to users), and having it available lowers the threshold for future extraction (e.g. stores, enums, type aliases) if the hand-maintained approach ever becomes a bottleneck.
2. **CEM runtime vs. build-time** — **decided: build-time.** CEM is already run at build time for primitives. The extractor just reads the output `custom-elements.json` — no runtime CEM invocation needed.
3. **Snapshot testing** — **decided: section-presence check only.** Assert that the assembled output contains expected section headers and a minimum count of components/tokens. Exact string snapshots would break on every component addition, defeating the purpose.
4. **Instruction file format** — **decided: single file.** Total context is ~600-800 lines (~3-4K tokens), well within any modern model's context window. Splitting adds `applyTo` routing complexity for no gain — schema generation needs ALL context (primitives + tokens + operators + stores) simultaneously. If ever split, split by audience (schema generation vs component development) not by topic. Revisit only if the file exceeds ~2K tokens or a specific smaller-model use case emerges.

---

## Relationship to Previous Plan

This plan supersedes the original `ai-context-package.md` (hand-written fragment approach) and incorporates the MCP pivot decision (MCP deferred indefinitely in favour of local agent instruction files).

| Previous                                 | This plan                                               |
| ---------------------------------------- | ------------------------------------------------------- |
| Per-package `ai-context.ts` hand-written | Auto-extracted from source                              |
| Fragments for all packages               | Fragments only for cross-cutting concerns + stores      |
| Store extractor (parse Solid.js types)   | Hand-maintained `stores.ts` fragment (7 stores, stable) |
| MCP as designed-for Layer 3              | MCP deferred; instruction files as primary output       |
| `mode: 'slim'` for MCP orientation       | Single mode — full context in instruction files         |
| No generated files committed             | Instruction files committed to source control           |
| No extraction tooling                    | Extractors for CEM, TypeScript, tokens, models          |
| No model/block awareness                 | Auto-extracted from `@we/models` (15 blocks, 4 entities)|
| Single prompt string for all consumers   | Reference content + per-consumer framing                |
| Props defined inline per framework       | Shared `*.types.ts` files ✅ (PR #7a complete)          |
| Generated file committed to source       | Build artifact in dist/ + committed instruction files   |
