# WE

WE is the interface layer over AD4M. A **seed** selects the modules, templates and themes of a deployment. The **app shell** renders the live **template**, a JSON schema, against reactive **stores**, and the stores reach an AD4M executor only through the **backend contract**.

**Why:** A template is data and not compiled code, so a person can inspect it, fork it, accept it from an untrusted source and let a model edit it in place. The data stays in AD4M perspectives that the person owns, so a change to the interface never loses the data (`packages/ai-context/src/fragments/architecture.ts`). One app shell renders every template, and each target adds only its platform and its connection to the executor.

This folder holds the mental models of this repository: a high-level expression of the code beside it, in a tree of short pages. The pages are kept 1-1 with the code. A pull request that changes a mental model changes its page in the same pull request. How the pages are written: [Conventions](CONVENTIONS.md).

## Parts
- [Interface](interface/README.md): what a person sees — schemas, templates, the design system and the editor.
- [Modules](modules/README.md): what extends WE — feature modules, blocks, the graph system and the seed.
- [Data](data/README.md): what WE stores and how it reaches it — entities, the backend contract, stores and spaces.
- [Hosts](hosts/README.md): what runs WE and how it starts — the targets, boot, identity custody, AI and the development hosts.

Terms: [Glossary](GLOSSARY.md).

<details><summary>How it works</summary>

```
 we-seed.json (seed) ── modules, templates, themes, apps ─────────┐
   │                                                              │ [Modules] contribute
   ▼                                                              ▼
 target: web │ Electron │ Tauri │ preview          [Hosts]   feature modules, blocks,
   │ platform adapter + backend connector                     graph plugins, elements
   ▼                                                              │
 app shell: PlatformProvider ─► App ─► StoreProvider ◄────────────┘
   │                                       │
   ▼                                       ▼
 template (JSON schema) ── rendered against ── stores           [Interface] [Data]
   │ schema renderer + component registry   │
   ▼                                        ▼
 DOM                          backend contract: DataSource, ports   [Data]
                                            │ @we/backend-ad4m
                                            ▼
                              AD4M executor (local or through ad4m-connect)
```

1. A target starts the [app shell](hosts/boot/README.md) with the seed, its platform adapter and its backend connector.
2. The session connects to the executor through the connector. The stores then load the agent's datasets and the current space.
3. The schema renderer draws the space's template. Each expression in the template reads a store, and each handler calls a store.
4. The stores read and write through the backend contract. `@we/backend-ad4m` carries each call to the AD4M executor.

</details>

<details><summary>Where in the code</summary>

- [apps/](../apps/): the targets (web, Electron, Tauri), the preview host and the playgrounds.
- [packages/app-shell/](../packages/app-shell/): the app shell, its stores and registries.
- [packages/schema-system/](../packages/schema-system/), [packages/design-system/](../packages/design-system/), [packages/templates/](../packages/templates/), [packages/editor/](../packages/editor/): schemas, components, templates and the editor.
- [packages/module-system/](../packages/module-system/), [packages/block-system/](../packages/block-system/), [packages/graph-system/](../packages/graph-system/): modules, blocks and the graph engine.
- [packages/entities/](../packages/entities/), [packages/backend-system/](../packages/backend-system/): the entities and the backend contract with its adapters.
- [packages/](../packages/): the other packages, among them `ai-context`, `agent-tools`, `identity-window`, `cli`, `e2e` and `csp`.
- [crates/custody/](../crates/custody/): the desktop custody service.
- [we-seed.json](../we-seed.json), [seed-examples/](../seed-examples/), [bundles/](../bundles/): the default seed, example seeds and app bundles.
- [scripts/](../scripts/): workspace scripts (seed validation, the executor download, `pnpm e2e`).
- [docs/](../docs/): the architecture docs and the guides; [VISION.md](../VISION.md): the reasons for WE.

</details>

## Index

- [WE](README.md)
  - [Interface](interface/README.md)
    - [Schema language](interface/schema/README.md)
      - [Schema nodes](interface/schema/nodes.md)
      - [Expressions](interface/schema/expressions.md)
      - [Handler tokens](interface/schema/handlers.md)
      - [Node operators](interface/schema/operators.md)
      - [Validation](interface/schema/validation.md)
    - [Renderer](interface/renderer/README.md)
      - [Component registry](interface/renderer/component-registry.md)
      - [Queries](interface/renderer/queries.md)
      - [Foreign elements](interface/renderer/foreign-elements.md)
    - [Templates](interface/templates/README.md)
      - [Fragments](interface/templates/fragments.md)
      - [Views](interface/templates/views.md)
      - [Bundles](interface/templates/bundles.md)
      - [Template tiers](interface/templates/tiers.md)
      - [Editor](interface/templates/editor.md)
    - [Design system](interface/design-system/README.md)
      - [Tokens](interface/design-system/tokens.md)
      - [Themes](interface/design-system/themes.md)
      - [Primitives](interface/design-system/primitives.md)
      - [Components](interface/design-system/components.md)
      - [Drag](interface/design-system/drag.md)
      - [Brand](interface/design-system/brand.md)
    - [Chrome](interface/chrome/README.md)
      - [Panels](interface/chrome/panels.md)
      - [Routing](interface/chrome/routing.md)
      - [Boards](interface/chrome/boards.md)
      - [Protected pieces](interface/chrome/protected-pieces.md)
  - [Modules](modules/README.md)
    - [Module contract](modules/contract/README.md)
      - [Contributions](modules/contract/contributions.md)
      - [Kernels](modules/contract/kernels.md)
      - [Store surface](modules/contract/store-surface.md)
      - [Module settings](modules/contract/settings.md)
      - [Module testing](modules/contract/testing.md)
    - [Module registry](modules/registry/README.md)
      - [Seed](modules/registry/seed.md)
      - [Lint and compatibility](modules/registry/lint.md)
      - [Enablement](modules/registry/enablement.md)
      - [Host kernels](modules/registry/host-kernels.md)
    - [Bundled modules](modules/bundled/README.md)
      - [Calls](modules/bundled/calls/README.md)
        - [Mesh](modules/bundled/calls/mesh.md)
        - [Backend sessions](modules/bundled/calls/sessions.md)
        - [Live](modules/bundled/calls/live.md)
      - [Transcription](modules/bundled/transcription/README.md)
        - [Capture](modules/bundled/transcription/capture.md)
        - [Interpretation](modules/bundled/transcription/interpretation.md)
      - [Feed](modules/bundled/feed.md)
      - [Personal modules](modules/bundled/personal.md)
      - [Space tools](modules/bundled/space-tools/README.md)
        - [Polls](modules/bundled/space-tools/polls.md)
        - [Globe](modules/bundled/space-tools/globe.md)
        - [Flux](modules/bundled/space-tools/flux.md)
    - [Blocks](modules/blocks/README.md)
      - [Persistence](modules/blocks/persistence.md)
      - [Composer](modules/blocks/composer.md)
    - [Graph system](modules/graph-system/README.md)
      - [Protocol](modules/graph-system/protocol.md)
      - [Engine](modules/graph-system/engine.md)
      - [Plugins](modules/graph-system/plugins.md)
      - [View](modules/graph-system/view.md)
  - [Data](data/README.md)
    - [Entities](data/entities/README.md)
      - [Manifest](data/entities/manifest.md)
      - [Entity proxies](data/entities/proxies.md)
      - [Write path](data/entities/writes.md)
      - [Relations](data/entities/relations.md)
    - [Backend contract](data/backend/README.md)
      - [Data source](data/backend/data-source.md)
      - [Dataset lifecycle](data/backend/lifecycle.md)
      - [Schemas](data/backend/schemas.md)
      - [Queries](data/backend/queries.md)
      - [Ephemeral and presence](data/backend/ephemeral.md)
    - [Adapters](data/adapters/README.md)
      - [AD4M adapter](data/adapters/ad4m.md)
      - [In-memory adapter](data/adapters/inmemory.md)
      - [Conformance suite](data/adapters/conformance.md)
    - [Stores](data/stores/README.md)
      - [Session](data/stores/session.md)
      - [Datasets](data/stores/datasets.md)
      - [Records](data/stores/records.md)
      - [Optimism](data/stores/optimism.md)
      - [Clocks](data/stores/clocks.md)
    - [Spaces](data/spaces/README.md)
      - [Creating and sharing](data/spaces/create.md)
      - [Joining](data/spaces/join.md)
      - [Shapes](data/spaces/shapes.md)
      - [Policy](data/spaces/policy.md)
  - [Hosts](hosts/README.md)
    - [Boot](hosts/boot/README.md)
      - [Providers](hosts/boot/providers.md)
      - [Session](hosts/boot/session.md)
      - [First screen](hosts/boot/first-screen.md)
      - [Build freshness](hosts/boot/build-freshness.md)
    - [Platform](hosts/platform/README.md)
      - [Backend connector](hosts/platform/backend-connector.md)
      - [Accounts](hosts/platform/accounts.md)
      - [Embedded apps](hosts/platform/embedded-apps.md)
    - [Targets](hosts/targets/README.md)
      - [Web](hosts/targets/web.md)
      - [Electron](hosts/targets/electron/README.md)
        - [Executor process](hosts/targets/electron/executor-process.md)
        - [Main process](hosts/targets/electron/main-process.md)
      - [Tauri](hosts/targets/tauri.md)
      - [Development hosts](hosts/targets/development/README.md)
        - [Preview host](hosts/targets/development/preview.md)
        - [Playgrounds](hosts/targets/development/playgrounds.md)
        - [CLI](hosts/targets/development/cli.md)
        - [End-to-end tests](hosts/targets/development/e2e.md)
    - [Identity](hosts/identity/README.md)
      - [Custody](hosts/identity/custody.md)
      - [Identity window](hosts/identity/identity-window.md)
      - [Devices](hosts/identity/devices.md)
    - [AI](hosts/ai/README.md)
      - [AI context](hosts/ai/ai-context.md)
      - [Agent tools](hosts/ai/agent-tools.md)
      - [In-app AI](hosts/ai/in-app.md)
- [Glossary](GLOSSARY.md)
- [Conventions](CONVENTIONS.md)
