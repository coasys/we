# Globe

The globe module (`@we/module-globe`) lends templates the `CesiumGlobe` component: a globe with layers of data on the earth and layers of the space around it. Cesium or MapLibre draws it. A template names the layers and never names the engine.

**Why:** The module is the proof that the contribution points are sufficient: it carries a globe that was built without the module system. The module holds only the wiring, and the component and the layers stay in their own packages. `createGlobeModule` takes the component as an argument and does not import it, so the package never pulls Solid or `@we/widgets` into its own bundle (`module/src/index.ts` header).

**Parent:** [Space tools](README.md)

<details><summary>How it works</summary>

**The globe family** (`packages/module-system/globe/`):

| Package | What it holds |
|---|---|
| `@we/globe-protocol` | What a layer kind is. Its meaning (id, slot, options) is the same on all engines, and each engine has a renderer. A kind without a renderer for the engine is absent. |
| `@we/globe-core` | All that is not drawing: which layers are mounted, geometry from rows, style rules, aggregation, clustering and diffs. |
| `@we/globe-layers` | The layer kinds: planet layers (points, paths, areas, hexbin, heatmap, and others) and background layers (skybox, procedural stars, solar system), with MapLibre renderers in `maplibre/`. |
| `@we/globe-widget` | The `CesiumGlobe` Solid component. |
| `@we/module-globe` | The module: `layerKinds`, `GLOBE_LAYER_CATALOG`, the engine choice and the store. |

**Engine.** The `engine` setting is `auto`, `cesium` or `maplibre`. `resolveEngine` gives MapLibre for `auto` on a device with a coarse pointer, 4 GB of memory or less, or 4 cores or fewer. The host's `GlobeOnDemand` loads the engine that it chooses (see [Host kernels](../../registry/host-kernels.md)). Both engines draw every planet kind. Only Cesium draws the background kinds. The store has `engine` and `drawsSpace`, so a template can leave out the background layers where they would not be drawn.

**Settings** (deployment and agent levels): `engine`, `imagery` (`nasa` by default, or `ion`, `esri`, `mapbox`), and a key for each commercial provider. A provider without a key draws NASA's imagery.

**The catalogue.** `GLOBE_LAYER_CATALOG` lists the `factory` names, their options and how style rules work, so that the generated context tells a template author which layers exist.

</details>

<details><summary>Where in the code</summary>

- [packages/module-system/globe/module/src/index.ts](../../../../packages/module-system/globe/module/src/index.ts): `createGlobeModule`, `createModule`, the settings.
- [packages/module-system/globe/module/src/engine.ts](../../../../packages/module-system/globe/module/src/engine.ts), [store.ts](../../../../packages/module-system/globe/module/src/store.ts): `resolveEngine`, `deviceHints`, `createGlobeStore`.
- [packages/module-system/globe/module/src/layers.ts](../../../../packages/module-system/globe/module/src/layers.ts), [catalog.ts](../../../../packages/module-system/globe/module/src/catalog.ts): `layerKinds`, `GLOBE_LAYER_CATALOG`.
- [packages/module-system/globe/protocol/src/index.ts](../../../../packages/module-system/globe/protocol/src/index.ts), [core/src/](../../../../packages/module-system/globe/core/src), [widget/src/](../../../../packages/module-system/globe/widget/src): the other packages.
- [packages/module-system/globe/layers/README.md](../../../../packages/module-system/globe/layers/README.md), [EXAMPLES.md](../../../../packages/module-system/globe/layers/EXAMPLES.md): how to write and place a layer.

</details>
