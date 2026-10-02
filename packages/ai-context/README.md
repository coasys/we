# @we/ai-context

Generates WE's AI/schema reference from the code itself — the package behind
`CLAUDE.md`. One assembly, emitted to every surface that needs it:

| Output                                                       | Consumer                                               |
| ------------------------------------------------------------ | ------------------------------------------------------ |
| `CLAUDE.md` (repo root)                                      | Claude Code and human orientation                      |
| `.github/copilot-instructions.md`                            | GitHub Copilot                                         |
| `.cursor/rules/we-schema.mdc`                                | Cursor                                                 |
| `packages/ai-context/src/schemaContext.ts`                   | The in-app AI editor's system prompt                   |
| `packages/ai-context/context.json`                           | Structured form of the same reference                  |
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
- `appShell.ts` — the store surface (every expression- or `$action`-reachable
  member) parsed from the store interfaces; its header records why this is
  derived rather than hand-listed
- `models.ts` / `tokens.ts` / `plugins.ts` — entity models, design tokens,
  and component plugin registries (GraphView's seeds/expanders/layouts)

**Fragments** (`src/fragments/`) are the hand-written halves: the
architecture orientation, schema structure and operator prose, store member
_descriptions_ (`stores.ts` — merged against the extracted surface; an entry
for a member that no longer exists fails the build), rules, and patterns.

`generate.ts` merges the two and writes every output. **Never edit the
outputs directly** — edit a fragment or an extractor and regenerate.

## Write the reference in the present tense

A fragment's reader is a model authoring a schema, and it has never seen a
previous version of this document. So **the reference describes the system as
it is. It never describes what the reference used to say.**

"The validator does refuse it, which this said it did not" is a sentence about
this document's own history: there is nothing the reader can do with it, and a
reference that admits it has been wrong invites doubt about every other claim
in it. Why something changed belongs in the commit message. Why the code is
shaped as it is belongs in a comment beside that code — including in the
non-emitted parts of these files, where it reads correctly, because there the
reader is a maintainer.

Three things look like history and only two of them are:

|                     | Example                                                                                      |                                                                                                                                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document history    | "the idiom this section used to recommend"                                                   | **Cut it.**                                                                                                                                                                                                                                  |
| Behaviour history   | "It used to crash; now each member is read as its own class"                                 | **State the present.** The fact survives, the archaeology goes.                                                                                                                                                                              |
| Evidence for a rule | "three symptoms, all of which have happened here"; "every gate prompt in the repo copied it" | **Keep — while it is true.** A reader who will meet the bad pattern in this repo needs to know it is bad, and "this has really happened" is how a rule earns attention. Say what the repo contains now, not what this document once advised. |

The third row is why this is a judgement rather than a find-and-replace: these
documents are concrete on purpose, and stripping every past tense would take
the evidence out with the archaeology.

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
