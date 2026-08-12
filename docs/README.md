# WE Documentation

Start with **[Why WE Exists](../VISION.md)** — the vision, the problem, and what WE is for.

## Getting Started

New to WE? Start here.

- [Developer Setup](getting-started/developer-setup.md) — Prerequisites, clone, build, run
- [Seed System](getting-started/seed-system.md) — How `we-seed.json` configures everything

## Architecture

How WE is designed and why.

- [Codebase Map](architecture/codebase-map.md) — **Start here.** Current package layering, AD4M runtime, render pipeline, framework-agnosticism strategy
- [Package Conventions](architecture/package-conventions.md) — How packages are structured and named in the monorepo
- [Routing & View State](architecture/routing-and-view-state.md) — Where UI state lives: path, query params (`syncParam`), device (`persist`), or nowhere — and how links carry template/theme suggestions
- [Template Fragments](architecture/template-fragments.md) — The template kit: what fragments are, the extraction threshold, and where the fragment layer is going. Read before adding to `@we/template-kit`
- [Why a Meta-App Instead of Many Separate Apps?](architecture/meta-app-vs-separate-apps.md) — Why shared continuity and cumulative evolution matter
- [Practical Examples](architecture/examples.md) — Simple examples of how WE ideas work in practice
- [Performance](architecture/performance.md) — What the template system and design system cost, measured against raw DOM and plain Solid

## Guides

How to build with WE.

- [Embedding External Apps](guides/embedding-external-apps.md) — The postMessage contract for embedding apps like Flux in the launcher

Per-system docs live with the code — every `packages/<system>/` directory has a README
(`graph-system`'s is the model), and packages with authoring rules carry a `CONVENTIONS.md`.

## Internal

Working notes for maintainers — plans, design decisions, and superseded documents.

- [decisions/](internal/decisions/) — Design decisions and rationale (block system, schema system, template storage, semantic predicates, AI integration)
- [plans/](internal/plans/) — Strategy docs for upcoming work
- [old/](internal/old/) — Superseded documents, kept for historical context — each carries a banner naming what replaced it

> **Note:** documents under `internal/old/` and some under `internal/plans/` describe designs that
> are aspirational or have drifted from the implementation. For the current state of the codebase,
> always use the [Codebase Map](architecture/codebase-map.md).
