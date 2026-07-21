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
- [Why a Meta-App Instead of Many Separate Apps?](architecture/meta-app-vs-separate-apps.md) — Why shared continuity and cumulative evolution matter
- [Practical Examples](architecture/examples.md) — Simple examples of how WE ideas work in practice
- [Performance](architecture/performance.md) — What the template system and design system cost, measured against raw DOM and plain Solid

## Guides

How to build with WE.

- [Launcher UI Customization](guides/launcher-ui-customization.md) — Customizing boot screen and settings via seed
- [Cesium Layers](guides/cesium/layers-guide.md) — Using the 3D globe layer system
- [Cesium Implementation](guides/cesium/implementation-summary.md) — Implementation details and status

## Internal

Working notes for maintainers — plans, design decisions, and superseded documents.

- [decisions/](internal/decisions/) — Design decisions and rationale (block system, schema system, template storage, semantic predicates, AI integration)
- [plans/](internal/plans/) — Strategy docs for upcoming work
- [old/](internal/old/) — Superseded documents, kept for historical context

> **Note:** documents under `internal/old/` and some under `internal/plans/` describe designs that
> are aspirational or have drifted from the implementation. They carry a warning banner. For the
> current state of the codebase, always use the [Codebase Map](architecture/codebase-map.md).
