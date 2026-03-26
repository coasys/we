# Plan: `@we/ai-context` — Auto-Extracted Context + MCP Evolution

> Replaces the previous hand-written fragment approach. This plan establishes auto-extraction from source as the primary strategy, with MCP tools as the designed-for long-term evolution.

---

## Problem

`schemaContext.ts` is a hand-written ~400-line string in `app-framework` that documents components, tokens, stores, and operators for AI schema generation. Problems:

1. **Wrong home** — runtime and tooling concerns are mixed
2. **Drifts from source** — no enforcement mechanism; manually maintained
3. **Doesn't scale** — as WE grows, a static dump injected upfront consumes ever more of a model's context window
4. **Single consumer assumed** — any future tooling must depend on `app-framework`
5. **No upgrade path** — hand-written fragments have no clear route to on-demand MCP tooling

---

## Strategy: Three Layers

```
Layer 1 (Now):    Auto-extract from source + JSDoc conventions
Layer 2 (Soon):   Assemble into structured context object + generated prompt
Layer 3 (Later):  Expose as MCP tools for on-demand, targeted lookups
```

Each layer builds on the previous. The data model is designed once; it serves all three.

---

## Layer 1 — Auto-Extraction from Source

### What gets extracted automatically

| Source                           | What we get                    | How                                                                  |
| -------------------------------- | ------------------------------ | -------------------------------------------------------------------- |
| `@we/primitives` web components  | Props + types                  | Custom Elements Manifest (CEM) — already configured                  |
| `@we/components` + `@we/widgets` | Props + types                  | Parse `*.types.ts` files (framework-agnostic shared prop interfaces) |
| `@we/design-system/1-tokens`     | All token values               | Read token objects directly (they're typed TS exports)               |
| `@we/app-framework` stores       | State keys + action signatures | Parse store TypeScript interfaces                                    |

This covers everything that _can_ be kept in sync mechanically.

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

- **Schema operators** (`$store`, `$if`, `$map`, `$forEach`, etc.) — these are system-level, not per-component
- **Routing patterns** — route arrays, path syntax, `$routes` outlet
- **Store usage patterns** — how to wire components to stores idiomatically
- **Rules + constraints** — "don't put `$expr` directly in children", "meta is required at root", etc.

These live in `packages/ai-context/src/fragments/` as before. They're architectural documentation that changes infrequently and earns its maintenance cost.

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
    ├── types.ts              # Shared types: ComponentEntry, StoreEntry, TokenSet, etc.
    ├── assembler.ts          # Composes all sources into AssembledContext
    ├── extractors/
    │   ├── cem.ts            # Reads CEM output for @we/primitives
    │   ├── typescript.ts     # Parses *.types.ts interfaces for components + widgets
    │   ├── tokens.ts         # Reads @we/design-tokens token objects
    │   └── stores.ts         # Parses store type definitions
    └── fragments/            # Hand-maintained (cross-cutting concerns only)
        ├── schema-operators.ts
        ├── routing.ts
        ├── store-patterns.ts
        └── rules.ts
```

**No per-package `ai-context.ts` files.** The extractors read the actual source directly.

### Two kinds of output

`@we/ai-context` serves two audiences with different needs:

**Build-time functions** (for tooling, testing, MCP):

```typescript
// Run extractors → return structured object
assembleContext(): AssembledContext

// Run extractors → return LLM-ready string
assemblePrompt(): string
```

These call extractors, parse source files, and do real work. They require access to the source tree and are **not suitable for runtime use** in production.

**Pre-built constant** (for runtime consumers like `app-framework`):

```typescript
// Pre-computed string, baked into dist/ at build time
export const schemaContext: string;
```

During `@we/ai-context`'s build step, the build script calls `assemblePrompt()` and writes the result as a string constant into the package's built output. Runtime consumers import this constant — they never run extractors themselves.

### How it works end-to-end

```
@we/ai-context build step:
  1. extractors parse source files
  2. assemblePrompt() produces the LLM-ready string
  3. string is written as `export const schemaContext = "..."` in dist/

Runtime (app-framework):
  import { schemaContext } from '@we/ai-context';   // just a string

Tooling / MCP (future):
  import { assembleContext } from '@we/ai-context';  // runs extractors live
```

The assembled context is a normal build artifact in `dist/`, gitignored like any other built package output. **No generated files are committed to source control.**

`@we/ai-context` is declared as a dependency in `app-framework`'s `package.json`. pnpm/turbo handles build ordering automatically — `@we/ai-context` builds before its dependents, just like any other package in the graph.

If extraction turns out to be slow, a lightweight cache (hash input files, skip re-extraction if unchanged) can be added. Wait to see if this is actually needed.

---

## Layer 3 — MCP Tools (Future, Designed For Now)

As WE grows, front-loading all context upfront doesn't scale. MCP (Model Context Protocol) allows AI agents to call tools on-demand — "look up the PopoverMenu component", "validate this schema", "list available widgets" — rather than receiving a static dump.

### The data model works for both

The `AssembledContext` object produced by Layer 2 is the same data that feeds MCP tool handlers. Build once, serve both:

```
assembleContext()
    │
    ├── → assemblePrompt()           (Layer 2: static dump for today's AI interface)
    └── → MCP tool registry          (Layer 3: on-demand lookup for future agents)
```

### Planned MCP tools

| Tool              | Input                           | Returns                                       |
| ----------------- | ------------------------------- | --------------------------------------------- |
| `list_components` | optional category filter        | All schema-renderable components              |
| `get_component`   | component type name             | Full props + description + schema usage notes |
| `validate_schema` | schema JSON                     | Valid / errors with explanations              |
| `list_tokens`     | category (spacing, color, etc.) | Available token values                        |
| `get_store_api`   | store name                      | State keys + action signatures                |
| `list_stores`     | —                               | All available stores                          |

### Where it lives

AD4M ships an MCP server with two kinds of tools: 57 static tools (hardcoded in Rust, no plugin API) and SHACL-generated dynamic tools (auto-created from `@Model` definitions in perspectives).

Investigation of AD4M's codebase reveals WE's MCP tools fall into two categories:

**Category 1 — Schema section operations:** The `SchemaSection` and `TemplateInstall` models (from the schema-customization plan) are standard AD4M models. Once added to a perspective, AD4M **automatically generates** CRUD tools (`schemasection_get`, `schemasection_set_schemajson`, etc.). These cover section editing for free — no custom tool code needed.

**Category 2 — Knowledge tools:** Component lookup, token discovery, store API inspection, schema validation. These read from `AssembledContext`, not AD4M perspectives. AD4M has **no plugin API** for custom static tools, so these need either a separate WE MCP server or a custom tool registration API in AD4M.

**Recommended path:** Use SHACL tools for section CRUD immediately. Stand up a lightweight WE MCP server for knowledge tools (unblocked, ships independently). Later, propose a custom tool registration API in AD4M to unify both under one endpoint.

See [mcp-tools.md](mcp-tools.md) for full integration analysis and phased PR scope.

### Why design for this now

- The `types.ts` schema (ComponentEntry, StoreEntry, etc.) should be designed to serve tool responses, not just string interpolation
- Extractors should produce live, re-queryable data — not just a one-shot string builder
- Avoids a refactor later when we want MCP; instead it's a natural extension

MCP implementation is **not in PR 1 or PR 2** — but the data model and package structure are designed with it in mind.

### MCP transition: prompt evolution

When MCP lands, `schemaContext` doesn't disappear — it shrinks. Most component/token/store detail moves to on-demand tool lookups, but agents still need a slim orientation prompt upfront covering:

- That WE's schema system exists and what it does
- That MCP tools are available and when to call them
- High-level categories (primitives, components, widgets, stores)
- The operator system (`$store`, `$if`, `$map`, etc.) — behavioural rules agents should internalise, not look up per-query

`assemblePrompt()` supports this via a mode parameter:

```typescript
assemblePrompt({ mode: 'full' }); // PR 2: everything in one string (~400+ lines)
assemblePrompt({ mode: 'slim' }); // PR 3: orientation + "use tools for details" (~50-80 lines)
```

The `AssembledContext` object is the single data source for both paths. Only the string output changes shape.

| Phase      | What gets sent upfront                             |
| ---------- | -------------------------------------------------- |
| PR 2 (now) | Full `schemaContext` — everything in one string    |
| PR 3 (MCP) | Slim orientation prompt + MCP tools for deep dives |

---

## Prerequisite: Shared `*.types.ts` Files

Before the TypeScript extractor can work reliably, component packages (`@we/components`, `@we/widgets`) need framework-agnostic shared types files. This is a prerequisite refactor.

### Current structure

```
PostCard/
├── PostCard.solid.tsx      # Solid implementation, props defined inline
└── (PostCard.react.tsx)    # Future React implementation
```

### Target structure

```
PostCard/
├── PostCard.types.ts       # Canonical props — framework-agnostic, @ai JSDoc lives here
├── PostCard.solid.tsx      # Solid implementation, imports from PostCard.types.ts
└── (PostCard.react.tsx)    # Future React implementation, imports from PostCard.types.ts
```

### Rules for `*.types.ts` files

1. **Framework-agnostic** — no `Accessor<T>`, `Signal<T>`, `JSX.Element`, `React.ReactNode`, etc.
2. **Plain TypeScript interfaces** — `export interface PostCardProps { ... }`
3. **`@ai` JSDoc lives here** — describes the component contract, not framework-specific rendering
4. **Each framework adapts** — Solid wraps props in `Accessor`, React uses as-is, etc.

This has two benefits:

- **For extraction:** the TypeScript extractor globs for `**/*.types.ts` and parses plain interfaces — no need to understand framework-specific type wrappers
- **For multi-framework support:** prop contracts are defined once and shared, preventing divergence between implementations

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

Three PRs forming a dependency chain. Each delivers standalone value and validates assumptions the next one depends on.

### PR 1: Shared `*.types.ts` refactor

Pure mechanical refactor — no new packages. Lands and stabilises before extraction builds on top of it.

- [ ] Extract shared prop interfaces from framework-specific files into `*.types.ts`
- [ ] Add `@ai` JSDoc to shared types files for components with non-obvious contracts
- [ ] Verify all framework implementations import from `*.types.ts`
- [ ] Confirm existing tests pass (no behavioural changes)

### PR 2: `@we/ai-context` package + migration

Depends on PR 1. Creates the extraction + assembly package and replaces the hand-written `schemaContext.ts`.

- [ ] Create `packages/ai-context/` with types, extractors, assembler, fragments
- [ ] Implement CEM extractor for `@we/primitives`
- [ ] Implement TypeScript extractor for `*.types.ts` in `@we/components` + `@we/widgets`
- [ ] Implement token extractor for `@we/design-tokens`
- [ ] Implement store extractor for `app-framework` stores
- [ ] Write hand-maintained fragments (operators, routing, store patterns, rules)
- [ ] Wire `@we/ai-context` build into turbo dependency graph
- [ ] Replace `schemaContext.ts` import with `import { schemaContext } from '@we/ai-context'`
- [ ] Validate extracted output against hand-written reference
- [ ] Update `docs/architecture/overview.md`

### PR 3: MCP tools (phased)

Depends on PR 2 being in production long enough to validate the `AssembledContext` data model. Covered in detail in [mcp-tools.md](mcp-tools.md).

**Phase 1** ships with the schema-customization PR — SHACL auto-generated tools for section CRUD are free once the models exist. No custom tool code needed.

**Phase 2** is the WE knowledge MCP server:

- [ ] Stand up lightweight MCP server in WE for knowledge tools
- [ ] Implement handlers backed by `AssembledContext`
- [ ] Wire schema validation tool to existing validators
- [ ] Add `assemblePrompt({ mode: 'slim' })` for MCP-aware orientation prompt
- [ ] Add tests for tool outputs
- [ ] Add docs and examples for agent usage

**Phase 3** (future) unifies endpoints:

- [ ] Propose custom tool registration API for AD4M MCP server
- [ ] Migrate WE knowledge tools to AD4M's unified endpoint

---

## Open Questions

1. **TypeScript parser choice** — use `ts-morph` (easier API, higher-level) or raw `typescript` compiler API (no extra dep)? `ts-morph` is probably right here. With the `*.types.ts` convention the parsing surface is much simpler, so raw TS API may now be viable too.
2. **CEM runtime vs. build-time** — CEM is already run at build time for primitives. The extractor just reads the output JSON, so this is straightforward.
3. **Storybook alignment** — stories are effectively usage documentation. Worth keeping in mind that stories and `@ai` JSDoc shouldn't diverge. Not blocking this PR, but worth noting.
4. **Snapshot testing** — should the assembled prompt output be snapshot-tested so regressions in extraction are caught? Probably yes, at least a character count / section presence check.
5. **`*.types.ts` refactor scope** — how many components currently define props inline vs. already having shared types? This determines the size of the prerequisite refactor.

---

## Relationship to Previous Plan

This plan supersedes `ai-context-package.md` (the hand-written fragment approach). Key differences:

| Previous                                 | This plan                                       |
| ---------------------------------------- | ----------------------------------------------- |
| Per-package `ai-context.ts` hand-written | Auto-extracted from source                      |
| Fragments for all packages               | Fragments only for cross-cutting concerns       |
| Static assembled prompt only             | Structured object designed for MCP evolution    |
| No extraction tooling                    | Extractors for CEM, TypeScript, tokens, stores  |
| Props defined inline per framework       | Shared `*.types.ts` files, framework-agnostic   |
| Generated file committed to source       | Build artifact only, imported as package export |

The package structure (`@we/ai-context`) and the fragment types (`AiContextFragment`, `ComponentEntry`, etc.) are largely the same.
