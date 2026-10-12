# WE Documentation

Start with **[Why WE Exists](../VISION.md)** — the vision, the problem, and what WE is for.

## Getting Started

New to WE? Start here.

- [Developer Setup](getting-started/developer-setup.md) — Prerequisites, clone, build, run
- [Seed System](getting-started/seed-system.md) — How `we-seed.json` configures everything

## Contributing

- [Contribution Surfaces](contributing/surfaces.md) — **Every slot WE accepts a contribution into.**
  What each is for, which one your intent belongs in, where its rules live, how to register it and
  how to check it. Start here when you know what you want to build but not where it goes.
- [CONTRIBUTING.md](../CONTRIBUTING.md) — The four contributor tracks, the workflow, working with an agent
- [Pull Requests](contributing/pull-requests.md) — How a PR is described, reviewed and merged
- [ad4m and Deploys](contributing/ad4m-and-deploys.md) — Which ad4m each build uses, where it deploys,
  pairing a WE PR with an ad4m change, bumping the pin, and making a release

## Architecture

How WE is designed and why.

- [Codebase Map](architecture/codebase-map.md) — **Start here.** Current package layering, AD4M runtime, render pipeline, framework-agnosticism strategy
- [Package Conventions](architecture/package-conventions.md) — How packages are structured and named in the monorepo
- [Routing & View State](architecture/routing-and-view-state.md) — Where UI state lives: path, query params (`syncParam`), device (`persist`), or nowhere — and how links carry template/theme suggestions
- [Template Fragments](architecture/template-fragments.md) — The template kit: what fragments are, the extraction threshold, and where the fragment layer is going. Read before adding to `@we/template-kit`
- [Why a Meta-App Instead of Many Separate Apps?](architecture/meta-app-vs-separate-apps.md) — Why shared continuity and cumulative evolution matter
- [Practical Examples](architecture/examples.md) — Simple examples of how WE ideas work in practice
- [Performance](architecture/performance.md) — What the template system and design system cost, measured against raw DOM and plain Solid
- [Distribution](architecture/module-marketplace.md) — The distribution ladder: which contribution surfaces can ship outside the repo, and what moves one down it

## Guides

How to build with WE.

- [Embedding External Apps](guides/embedding-external-apps.md) — The postMessage contract for embedding apps like Flux in the launcher

Per-system docs live with the code — every `packages/<system>/` directory has a README
(`graph-system`'s is the model), and packages with authoring rules carry a `CONVENTIONS.md`.

## Decisions

The choices every later change has to respect — one file each, with what was rejected and when to
revisit it: [architecture/decisions/](architecture/decisions/README.md). For the current state of the
code, use the [Codebase Map](architecture/codebase-map.md).

Working notes — plans, research, drafts — are kept outside the repo.
