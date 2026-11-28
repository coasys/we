# Module registry

`moduleRegistry` is the app shell's record of every module that registered in this build. At boot it registers each module that the seed names. It lints the definition, checks it against the host, builds its store with the declared kernels, and registers its slots and panels. The host reads the module's entities, blocks, views, functions and components from the registry (`moduleSchemas`, `blocks`, `views`, `functions`, `components`).

**Why:** The registry refuses a module at registration and does not half-mount it. A module whose backend, framework or kernel does not match would otherwise register chrome that fails at render time, far from the cause (`register` comment). Boot reports each refused module by name, because a module that is only absent looks like a missing switch (`initializeIntegrations`).

**Parent:** [Modules](../README.md)

## Parts
- [Seed](seed.md): `we-seed.json`, the `modules` list, and how `generate-modules` makes the bundled-module registry from it.
- [Lint and compatibility](lint.md): `lintModule`, `checkModuleCompatibility`, and the surface type of a module.
- [Enablement](enablement.md): the four layers that decide whether a module runs here, the chrome gate, and the module rail.
- [Host kernels](host-kernels.md): how the shell implements each kernel over its own stores, and binds them late.

<details><summary>How it works</summary>

`moduleRegistry.register(definition, host, storeDeps)`:

1. `lintModule(definition)`. A problem refuses the module. A warning is logged.
2. A warning if another module already declared the same activity type.
3. `checkModuleCompatibility(definition, host)`. An incompatible module is refused.
4. If the id is registered already, `unregister` it first, so a hot reload does not make two of everything.
5. `createStore(depsFor(...))`: the deps get only the kernels that the manifest names, a per-module `onDispose`, `settings` and the `secrets` kernel. Presence publishes are checked against the declared `activities` (in development only). Media publishes record which module publishes.
6. The store goes into `moduleStores[id]`, which is `modules.<id>` for the renderer.
7. Each slot goes into `slotRegistry`, wrapped in `gateOnSpace`. Each panel goes into `dockRegistry` (for geometry) and into `slotRegistry` at `dock-right` (for its frame).

Entities are compiled later, on the first dataset install (`declaredEntities`), and the module's blocks are registered then (`registerModuleBlocks`), because a block registration carries the compiled class. `unregister` removes the slots, panels, entities and blocks, then runs the store's disposers in reverse order.

Embedded apps from the seed's `apps` list also register here, as modules whose only contribution is an `embed` and which require the `ad4m` backend. After the seed's modules register, `danglingAnchors()` warns about slots on anchors that no module opens.

Marketplace: a module is not installed from a stranger at run time. A module from outside this repository arrives as a package that the seed names, and the deployment rebuilds. The surfaces that do install at run time are templates, themes, views and bundles ([Interface](../../interface/README.md)).

</details>

<details><summary>Where in the code</summary>

- [packages/app-shell/src/shared/registries/moduleRegistry.ts](../../../packages/app-shell/src/shared/registries/moduleRegistry.ts): `moduleRegistry`, `depsFor`, `gateOnSpace`, `moduleStores`, `declaredEntities`, `registerModuleBlocks`, `checkActivity`.
- [packages/app-shell/src/shared/initializeIntegrations.ts](../../../packages/app-shell/src/shared/initializeIntegrations.ts): `initializeIntegrations`, which registers embedded apps and seed modules.
- [packages/app-shell/src/shared/registries/bundledModules.ts](../../../packages/app-shell/src/shared/registries/bundledModules.ts): `activateSeedModules`.
- [docs/architecture/module-marketplace.md](../../../docs/architecture/module-marketplace.md): the distribution ladder for every surface.
- [docs/architecture/capabilities-and-surfaces.md](../../../docs/architecture/capabilities-and-surfaces.md): where a capability goes.

</details>
