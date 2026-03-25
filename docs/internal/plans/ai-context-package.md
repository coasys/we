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

| Source | What we get | How |
|--------|-------------|-----|
| `@we/primitives` web components | Props + types | Custom Elements Manifest (CEM) — already configured |
| `@we/components` + `@we/widgets` SolidJS components | Props + types | Parse exported `*Props` TypeScript interfaces |
| `@we/design-system/1-tokens` | All token values | Read token objects directly (they're typed TS exports) |
| `@we/app-framework` stores | State keys + action signatures | Parse store TypeScript interfaces |

This covers everything that *can* be kept in sync mechanically.

### JSDoc convention — only where needed

Most components are self-describing from their name and prop types alone. JSDoc is only added when a component has non-obvious contracts:

- **Option shapes** — e.g. PopoverMenu expects `{ id, name, icon }[]`; TypeScript says `object[]`
- **Schema-only vs programmatic-only** — intent that TypeScript can't express (e.g. `CesiumGlobe` can't be schema-rendered)
- **Store coupling** — e.g. "use `$map` to derive this prop from `templateStore.templates`"
- **Slot conventions** — non-obvious named slots

Convention: a `@ai` JSDoc tag on the component's props type or class. Example:

```typescript
/**
 * @ai Dropdown menu for selecting one option.
 * Options must have shape `{ id: string; name: string; icon: string }[]`.
 * Use $map to derive options and selectedOption from store data — see stores section.
 * Pattern: options from templateStore.templates, selectedOption from templateStore.currentTemplate.
 */
export type PopoverMenuProps = {
  options: Accessor<{ id: string; name: string; icon: string }[]>;
  selectedOption: Accessor<{ id: string; name: string; icon: string }>;
  onSelect: (option: { id: string; name: string; icon: string }) => void;
}
```

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
    │   ├── typescript.ts     # Parses *Props interfaces for SolidJS components
    │   ├── tokens.ts         # Reads @we/design-tokens token objects
    │   └── stores.ts         # Parses store type definitions
    └── fragments/            # Hand-maintained (cross-cutting concerns only)
        ├── schema-operators.ts
        ├── routing.ts
        ├── store-patterns.ts
        └── rules.ts
```

**No per-package `ai-context.ts` files.** The extractors read the actual source directly.

### Two outputs from `assembleContext()`

```typescript
// Structured object — for programmatic use, MCP, validation
assembleContext(): AssembledContext

// LLM-ready string — replaces schemaContext.ts
assemblePrompt(): string
```

### Generation script in `@we/cli`

```
packages/cli/scripts/generate-ai-context.ts
```

Runs extractors → calls `assemblePrompt()` → writes to:
```
packages/app-framework/src/shared/prompts/generated/schemaContext.ts  (AUTO-GENERATED)
```

Runs as `pnpm generate:ai-context` and as part of `pnpm build`.

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

| Tool | Input | Returns |
|------|-------|---------|
| `list_components` | optional category filter | All schema-renderable components |
| `get_component` | component type name | Full props + description + schema usage notes |
| `validate_schema` | schema JSON | Valid / errors with explanations |
| `list_tokens` | category (spacing, color, etc.) | Available token values |
| `get_store_api` | store name | State keys + action signatures |
| `list_stores` | — | All available stores |

### Where it lives

AD4M already ships an MCP server. The WE MCP tools would be a plugin/extension to that, exposed via `packages/ai-context/` as an MCP handler registry. The same package that assembles the prompt also registers the tools — same data, two interfaces.

### Why design for this now

- The `types.ts` schema (ComponentEntry, StoreEntry, etc.) should be designed to serve tool responses, not just string interpolation
- Extractors should produce live, re-queryable data — not just a one-shot string builder
- Avoids a refactor later when we want MCP; instead it's a natural extension

MCP implementation is **not in this PR** — but the data model and package structure are designed with it in mind.

---

## Migration: Existing `schemaContext.ts`

The hand-written file is the reference for quality. Steps:

1. Run extractors against current codebase — compare output to hand-written
2. For any components where auto-extracted docs are thin, add `@ai` JSDoc to the source
3. Port the cross-cutting content (operators, routing, rules) to `fragments/`
4. Run `generate:ai-context` — verify output is equivalent or better
5. Delete `schemaContext.ts`; replace its import with the generated version
6. Mark generated file as `// AUTO-GENERATED — do not edit`

---

## PR Scope

### Phase 1 (this PR)
- [ ] Create `packages/ai-context/` with types, extractors, assembler, fragments
- [ ] Implement CEM extractor for `@we/primitives`
- [ ] Implement TypeScript props extractor for `@we/components` + `@we/widgets`
- [ ] Implement token extractor for `@we/design-tokens`
- [ ] Implement store extractor for `app-framework` stores
- [ ] Write hand-maintained fragments (operators, routing, store patterns, rules)
- [ ] Add `@ai` JSDoc to any components with non-obvious contracts (PopoverMenu, CesiumGlobe, etc.)
- [ ] Add `generate:ai-context` script to `@we/cli`
- [ ] Wire into `pnpm build`
- [ ] Replace `schemaContext.ts` with generated version
- [ ] Update `docs/architecture/overview.md`

### Out of scope (future PRs)
- MCP tool registry implementation
- Per-package `ai-context.ts` files (eliminated by this approach)
- Storybook integration / story-as-documentation alignment
- Contributor/module/governance context fragments

---

## Open Questions

1. **TypeScript parser choice** — use `ts-morph` (easier API, higher-level) or raw `typescript` compiler API (no extra dep)? `ts-morph` is probably right here.
2. **CEM runtime vs. build-time** — CEM is already run at build time for primitives. The extractor just reads the output JSON, so this is straightforward.
3. **Storybook alignment** — stories are effectively usage documentation. Worth keeping in mind that stories and `@ai` JSDoc shouldn't diverge. Not blocking this PR, but worth noting.
4. **Snapshot testing** — should the generated `schemaContext.ts` be snapshot-tested so regressions in extraction are caught? Probably yes, at least a character count / section presence check.

---

## Relationship to Previous Plan

This plan supersedes `ai-context-package.md` (the hand-written fragment approach). Key differences:

| Previous | This plan |
|----------|-----------|
| Per-package `ai-context.ts` hand-written | Auto-extracted from source |
| Fragments for all packages | Fragments only for cross-cutting concerns |
| Static assembled prompt only | Structured object designed for MCP evolution |
| No extraction tooling | Extractors for CEM, TypeScript, tokens, stores |

The package structure (`@we/ai-context`) and the fragment types (`AiContextFragment`, `ComponentEntry`, etc.) are largely the same.
