# Contributing to WE

WE is not a framework where developers build modules and everyone else consumes them. It's a ladder,
and the widest rungs need no code at all. Most of what flows through this ecosystem will be templates
and themes made by people who never open a code editor — exactly as WordPress's ecosystem is
dominated by themes rather than plugins.

So the first question isn't "how do I set up the repo". It's **which rung are you on**.

---

## Four ways to contribute

### 1. You use WE and want your space to work differently

Reshape it in the browser. Build a template that fits how your group actually works, or a theme that
gives it an identity, and share it. Templates and themes are data, not code — they install from a
stranger without executing anything, and they can be forked and edited in place.

This is the highest-volume and most under-served contribution in the ecosystem. **You don't need this
repository at all.**

### 2. You author templates and themes seriously

You want the generated schema reference: the **Component Registry**, **Design Tokens** and **Schema
Operators** sections of [CLAUDE.md](./CLAUDE.md). They are extracted from the code on every build, so
they list exactly the components, props and tokens that actually exist — no drift, and every AI
coding assistant reads the same file.

Then read the [Themes](./docs/contributing/surfaces.md#themes),
[Shell templates](./docs/contributing/surfaces.md#shell-templates) and
[Views](./docs/contributing/surfaces.md#views) entries in the surfaces guide.

### 3. You want to add to this codebase

Start with **[docs/contributing/surfaces.md](./docs/contributing/surfaces.md)** — every slot WE
accepts a contribution into, what shape it takes, where its rules live, how to register it and how to
check it. Find your surface there, then read that surface's `CONVENTIONS.md`.

If you don't yet know how the pieces fit together, read
[docs/architecture/codebase-map.md](./docs/architecture/codebase-map.md) first.

### 4. You're building a deployment on WE

You mostly want the [seed system](./docs/getting-started/seed-system.md). A deployment is described
by `we-seed.json` — which modules ship, which templates and views, what the shell is white-labelled
to, how the executor is wired. Most "we need to build X" turns out to be a seed selecting from what
already exists.

---

## Working in this repository

### Setup

```sh
pnpm install
pnpm build          # first time only; after that, scope it (see below)
pnpm dev            # or dev:electron / dev:tauri
```

Full prerequisites, the AD4M executor binary and the platform targets are in
[docs/getting-started/developer-setup.md](./docs/getting-started/developer-setup.md).

### Branching

`dev` is where all active work happens. `main` is the production branch and only receives periodic
merges for releases.

**Always branch from `dev`, and always diff against `dev`** — `git diff dev...HEAD`, not `main`.

### Before you open a PR

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm validate:schemas      # if you touched any .schema.ts
pnpm validate:seed         # if you touched we-seed.json
```

Two schema audits are worth knowing about and are easy to miss — they import and walk the
**composed** tree, so they attribute nodes that a fragment from another package contributed, which no
grep over source can do:

```sh
pnpm --filter @we/schema-shared role-audit     # colours naming a scale position where a role belongs
pnpm --filter @we/schema-shared surface-audit  # what each surface-sunken is actually sitting on
```

A pre-commit hook runs ESLint and Prettier on staged files only. It is deliberately narrow — it
catches the formatting slip that would otherwise cost a CI round trip, not the whole pipeline.

### Rebuilding

A full `pnpm build` walks the monorepo and takes minutes. During iteration, rebuild only what you
touched and what depends on it:

```sh
pnpm --filter @we/tokens --filter @we/themes build
```

But **do** rebuild — a stale `dist` is invisible and costs more time than the build saves. See
"Rebuilding — scope it to what changed" in [CLAUDE.md](./CLAUDE.md) for the symptoms and the
staleness check.

### Generated files — never edit by hand

`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md` and `.cursor/rules/we-schema.mdc` are all
written from `packages/ai-context/src/fragments/`. Edit the fragment, then:

```sh
pnpm --filter @we/ai-context generate-context
```

and commit the fragment change and the regenerated files together.

---

## Working with an AI agent

The repository is written to be legible to coding agents, and most contributors will use one.

- **`CLAUDE.md` / `AGENTS.md`** are the same generated reference — architecture orientation, the
  contribution-surface router, the full schema reference, and developer patterns. Any agent that
  reads either file starts with the whole picture. `.github/copilot-instructions.md` and
  `.cursor/rules/we-schema.mdc` carry identical content for those tools.
- **Point your agent at the surface first.** The most common failure is an agent writing a perfectly
  good component when the thing wanted was a fragment, or writing a view and never registering it.
  The surfaces guide exists to prevent exactly that; the "Register" line of each entry is the step
  agents skip.
- **Don't let it stand up an executor.** Verifying a UI change does not need a running AD4M node.
  Typecheck, validate schemas, run the package's tests.
- **Conventions live beside the code.** If an agent is guessing at a convention, the answer is
  almost certainly in that package's `CONVENTIONS.md` — there are ten of them, and the surfaces guide
  links every one.

---

## Documentation

Per-system docs live with the code: every `packages/<system>/` directory has a README
(`graph-system`'s is the model), and packages with authoring rules carry a `CONVENTIONS.md`.

- [docs/README.md](./docs/README.md) — the index
- [VISION.md](./VISION.md) — why WE exists, and who contributes what
- [docs/architecture/](./docs/architecture/) — how it's designed and why

Documents under `docs/internal/` are working notes for maintainers. Each plan carries a **Status**
line saying whether it is shipped, in progress, aspirational or superseded — check it before treating
a plan as a description of the code. Anything under `internal/old/` has been superseded.

---

## License

MIT (per-package `license` fields).
