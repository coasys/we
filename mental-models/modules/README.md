# Modules

A **feature module** is a capability that a space turns on: calls, transcription, a feed, notes, polls, a globe, a graph. A module is mostly data (a manifest and its contributions) plus at most one piece of code (a store factory), and the **seed** selects which modules a deployment builds in.

**Why:** A template is data and can come from anyone, but a capability needs state and code. The module contract keeps the code in one place (`createStore`), behind named host capabilities (**kernels**), so that everything else a module adds (panels, parts, settings, entities) stays data that the host can check, gate and show at install. Modules are bundled into the build and not loaded at run time, because a store factory is arbitrary code with the host's ports (`bundledModules.ts`).

**Parent:** [WE](../README.md)

## Parts
- [Module contract](contract/README.md): `ModuleDefinition`, its manifest, contributions, kernels, store surface, settings and tests.
- [Module registry](registry/README.md): how the shell lints, registers, enables and serves modules, and how the seed's `modules` list becomes the registry.
- [Bundled modules](bundled/README.md): the modules in `packages/module-system/`: calls, transcription, feed, notes and Pocket, polls, globe, Flux.
- [Blocks](blocks/README.md): the block content model, its persistence and the block composer.
- [Graph system](graph-system/README.md): the graph engine, its plugins, its Solid view and the graph module.

<details><summary>How it works</summary>

```
we-seed.json  modules: [call, transcribe, feed, …]
      │  generate-modules
      ▼
bundledModules.generated.ts ── createModule(host) per package ──► ModuleDefinition
      │                                                              manifest      (data)
      │  initializeIntegrations → activateSeedModules                contributes   (data)
      ▼                                                              createStore   (code)
moduleRegistry.register(def, host, storeDeps)
      ├─ lintModule, checkModuleCompatibility
      ├─ createStore(deps)  ── deps.kernels: only the kernels the manifest names
      ├─ store  → modules.<id>.*  (public members only, for templates)
      ├─ slots  → slotRegistry   (gated on spaceStore.activeModules)
      ├─ panels → dockRegistry
      └─ entities, blocks, views, functions, components → their host registries
```

A module never imports another module. Two modules cooperate through a medium that both reach: a presence activity, the `media` kernel, an anchor that one module opens and another fills, or records in the space. The transcription module hears a call this way ([Transcription](bundled/transcription/README.md)).

The data side of a module (entities, records, spaces) is in the [Data](../data/README.md) branch. The templates that place module parts are in the [Interface](../interface/README.md) branch. App boot, which calls the registry, is in the [Hosts](../hosts/README.md) branch.

</details>

<details><summary>Where in the code</summary>

- [packages/module-system/](../../packages/module-system): the contract, the testing kit and every bundled module.
- [packages/block-system/](../../packages/block-system): blocks.
- [packages/graph-system/](../../packages/graph-system): the graph engine.
- [we-seed.json](../../we-seed.json): the default seed.
- [docs/architecture/capabilities-and-surfaces.md](../../docs/architecture/capabilities-and-surfaces.md): where a new capability goes, and how two capabilities cooperate.
- [docs/architecture/module-marketplace.md](../../docs/architecture/module-marketplace.md): which surface can reach a stranger, and how.
- [docs/guides/writing-a-module.md](../../docs/guides/writing-a-module.md): the module author's guide.

</details>
