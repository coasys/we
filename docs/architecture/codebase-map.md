# WE Architecture

The depth companion to the **Architecture Orientation** section in `CLAUDE.md` (and the other
generated IDE reference files). That orientation is the always-loaded map; this doc holds the
detail that doesn't need to sit in every agent's context.

> This file is **hand-maintained** — it is _not_ auto-generated. Update it directly. The concise
> orientation lives in `packages/ai-context/src/fragments/architecture.ts`; keep the two in sync
> when the high-level model changes.

## Contents

- [The composability stack](#the-composability-stack)
- [AD4M runtime & data model](#ad4m-runtime--data-model)
- [Schema render pipeline](#schema-render-pipeline)
- [Framework-agnosticism strategy](#framework-agnosticism-strategy)
- [Block & editor system](#block--editor-system) _(to expand)_
- [Seed system & deployment](#seed-system--deployment) _(to expand)_
- [Local dev, build & test loop](#local-dev-build--test-loop) _(to expand)_

---

## The composability stack

WE is the UI layer of a three-part stack for distributed collective intelligence:

1. **WE** — composable design system + module marketplace (what users see and interact with).
2. **AD4M** — ontological layer for data, meaning, and agent coordination (how data flows/connects).
3. **Holochain** — trust, validation, and sync (how agreements are enforced, how peers sync).

Contributions are **modules**, not apps, at every level of abstraction: design tokens →
primitives → components → widgets → templates, plus blocks, themes, template fragments
(`@we/template-kit` — see `template-fragments.md`), and feature modules (call, notes, transcribe,
globe, graph). All are shareable through one module marketplace. A finished "app" is a **seed**
that composes modules. See `VISION.md` for the full rationale.

## AD4M runtime & data model

WE's data layer is [AD4M](https://ad4m.dev): agent-centric, local-first, peer-to-peer.

- **Agent / DID** — user identity; `sessionStore.me.did` (prefer the `$me` token in schemas).
- **Perspective / dataset** — a local knowledge graph (links/triples). The codebase says
  **dataset** at the contract layer (`DatasetStore`, `currentDataset`) and perspective at the AD4M
  layer; every Space is backed by one. `datasetStore.currentDataset` = the active dataset;
  `datasetStore.rootDataset` = we-root models (AgentSettings, ChatSession, installed
  templates/themes).
- **Neighbourhood** — a _shared_ perspective, synced peer-to-peer via Holochain. A shared Space is
  a neighbourhood.
- **SDNA (Social DNA)** — SHACL schemas installed into a perspective defining its data model. WE's
  models are SDNA-typed. `spaceStore.initializeAsWeSpace` installs WE's Space SDNA into a
  foreign/joined perspective (e.g. one synced in from Flux) so WE can read/write it.
- **Expression / Language** — content addressed by a URL, stored/retrieved via a Language plugin
  (e.g. image uploads → FILE_STORAGE_LANGUAGE → an expression URL published to a perspective).
- **Model (Ad4mModel)** — WE's ORM over perspective links (`Space.create`, `findAll`, `findOne`,
  `include`, relation accessors). CRUD conventions are in the generated **Developer Patterns**
  section; model authoring rules are in `packages/models/CONVENTIONS.md`.

The Solid app (`@we/app-shell`) reaches AD4M through the **backend contract** rather than
directly: `@we/backend-shared` declares the ports (`DataSource` + `QueryAdapter`, ephemeral,
presence, transcription, model manifest), `@we/backend-ad4m` implements them against the executor,
and `@we/backend-inmemory` is the reference implementation the boot/conformance tests run against.
Stores (`sessionStore`, `datasetStore`, `spaceStore`, …) sit above the ports and expose reactive
state to schemas. The renderer, the design system and the module contract never import
`@coasys/*`.

> **To expand:** exact connection/bootstrap flow, personal vs shared perspective lifecycle, how
> `switchPerspective` registers SHACL models as dynamic classes, and the sync/conflict model.

## Schema render pipeline

A **Template** is a JSON schema (a tree of nodes). Rendering:

1. Each node has `type`, `props`, `children`, and optional `routes` / `slots` / `$localState` /
   `$queries`.
2. Props resolve through the shared dispatcher (`@we/schema-shared` → `propResolvers/dispatcher.ts`).
   Token objects (`$store`, `$if`, `$query`, `$local`, `$action`, …) become plain values or
   **reactive accessors** via a framework-injected `memo`; `markReactive()` tags accessors.
3. The renderer (`@we/schema-solid`) looks up `type` in the `ComponentRegistry`: a custom-element
   tag string for `@we/primitives`, a framework component for `@we/components` / `@we/widgets`.
4. It mounts the node, binds accessors as reactive props, wires custom events, and recurses. Block
   `$`-types (`$each`, `$if`, `$single`, `$animate`, `$routes`) map to Solid control flow
   (`<For>` / `<Show>` / `<Dynamic>` / router outlet).

The full authoring surface (operators, components, tokens, models, stores) is documented in the
generated schema reference (the bulk of `CLAUDE.md`).

## Framework-agnosticism strategy

The seam is drawn so framework choice is isolated to thin adapters:

- **Tokens, themes, primitives** — framework-neutral by construction (CSS vars; Lit web components).
- **`@we/schema-shared`** — all schema semantics + a reactivity _port_ (`memo` + `markReactive`).
  Nothing framework-specific leaks in.
- **`@we/schema-solid`** — a thin renderer that injects Solid's `createMemo` and maps control flow.
  A React/Vue/Svelte adapter is a new package of the same shape.
- **`@we/components` / `@we/widgets`** — currently Solid (`.types.ts` + `.solid.tsx`). Layout
  primitives (Row/Column) stay per-framework on purpose (highest cardinality, pure styling, cheap to
  replicate, worst web-component cost); their DS-props → CSS computation is shared in
  `@we/design-utils`'s neutral core, so each binding is a thin reactive wrapper.

Mixed-framework templates cross the **web-component boundary** (a foreign component is rendered as a
custom element, exactly like a primitive), kept as a deliberate island rather than the default.

## Graph system

`packages/graph-system/` is the graph engine behind `GraphView`: `@we/graph-protocol` (the
expander/layout/behaviour contracts and address scheme), `@we/graph-core` (the neutral engine —
store, spatial index, camera, expansion state, pointer behaviours), `@we/graph-expanders` and
`@we/graph-layouts` (first-party plugins), and `@we/graph-solid` (the Solid adapter). Its data
binding into the app lives at `packages/app-shell/src/frameworks/solid/components/GraphHost.tsx`.
See `packages/graph-system/README.md` for the decisions worth knowing before changing anything.

## Template kit

`@we/template-kit` holds reusable template fragments — authoring-time helpers that expand to plain
schema nodes (`marketplaceList`, `installedList`, `cardShell`, `emptyState`, …). What belongs in
the kit, the extraction threshold, and the options-object API are documented in
`packages/templates/kit/CONVENTIONS.md`; the direction of travel is `template-fragments.md` in
this directory.

## Block & editor system

`@we/block-shared` holds block content types + serialization; blocks (TextBlock, ImageBlock,
EmbedBlock, CodeBlock, …) are AD4M models composed by the block composer.

> **To expand:** BlockComposer/BlockRenderer, editor state format, how posts serialize to/from
> blocks (`spaceStore.createPost` / `updatePost` reconciliation), and the Solid block renderer package.

## Seed system & deployment

Every deployment starts from a **seed file** (`we-seed.json`): which modules to include, how to
arrange/theme them, and platform settings — making white-labeling a matter of swapping the seed.

> **To expand:** seed schema, `scripts/validate-seed.cjs`, and how a seed maps to installed
> templates/themes/modules at boot. See `docs/getting-started/seed-system.md`.

## Local dev, build & test loop

- Run: `pnpm dev:web` / `pnpm dev:electron` / `pnpm dev:tauri`.
- Build: `pnpm build` (all packages) or per-target `build:web` / `build:electron` / `build:tauri`.
- Validate schemas: `pnpm --filter @we/schema-shared validate`.
- Regenerate AI context: `pnpm --filter @we/ai-context generate-context`.

> **To expand:** test setup and where tests live, the AD4M executor binary rebuild flow (see the
> generated Developer Patterns section), and what "verify a change" means without spinning up the
> full backend.
