# @we/ai-context

Generates WE's AI/schema reference from the code itself — the package behind
`CLAUDE.md`. One assembly, emitted to every surface that needs it:

| Output                                                  | Consumer                                    |
| ------------------------------------------------------- | ------------------------------------------- |
| `CLAUDE.md` (repo root)                                 | Claude Code and human orientation           |
| `.github/copilot-instructions.md`                       | GitHub Copilot                              |
| `.cursor/rules/we-schema.mdc`                           | Cursor                                      |
| `packages/ai-context/src/schemaContext.ts`              | The in-app AI editor's system prompt        |
| `packages/ai-context/context.json`                      | Structured form of the same reference       |
| `packages/schema-system/shared/src/generated/contextData.ts` | The schema validator's component/store/token knowledge |

All six are tracked; CI diffs them after `pnpm build`, so changing an input
without committing the regenerated output fails the build.

```bash
pnpm --filter @we/ai-context generate-context   # regenerate everything
```

## How it works: extractors × fragments

**Extractors** (`src/extractors/`) derive what can be derived, so the
reference cannot silently drift from the code:

- `cem.ts` — primitives + props from the Custom Elements Manifest
- `typescript.ts` — Solid component props via ts-morph (function declarations
  with a `@superclass` JSDoc tag)
- `appShell.ts` — the store surface (every `$store`/`$action`-reachable
  member) parsed from the store interfaces; its header records why this is
  derived rather than hand-listed
- `models.ts` / `tokens.ts` / `plugins.ts` — entity models, design tokens,
  and component plugin registries (GraphView's seeds/expanders/layouts)

**Fragments** (`src/fragments/`) are the hand-written halves: the
architecture orientation, schema structure and operator prose, store member
*descriptions* (`stores.ts` — merged against the extracted surface; an entry
for a member that no longer exists fails the build), rules, and patterns.

`generate.ts` merges the two and writes every output. **Never edit the
outputs directly** — edit a fragment or an extractor and regenerate.

## When you change…

- A store's public surface → regenerate; add/update the member's description
  in `fragments/stores.ts` (stale entries fail the build, undocumented new
  members are only counted).
- A primitive/component/prop → rebuild the package (the CEM regenerates),
  then regenerate here.
- Schema semantics, rules, patterns → the matching fragment, then regenerate.

The runtime side: `@we/app-shell` dynamically imports this package for the
in-app AI editor's context (`src/shared/ai/aiInfra.ts`), and the validator
consumes `contextData.ts` — so this package is a runtime dependency, not just
tooling.
