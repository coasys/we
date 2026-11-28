# Plugins

A plugin is code that a template names from data: an expander, a seed source, a layout, a behaviour, a node renderer, a metric or a control. `PluginRegistry` holds them by id. `GraphView` makes one registry for each graph and fills it with the sets that WE ships.

**Why:** A template is JSON, so code must be reachable from JSON by name. Templates and components use the same rule one level up. A registry belongs to one graph instance and is not global, because with a global registry two graphs on one page would share what the last one registered (`registry.ts` header). The default sets are functions, so each engine gets its own objects (`defaultExpanders` comment).

**Parent:** [Graph system](README.md)

<details><summary>How it works</summary>

`GraphPlugins` is `{ expanders, seeds, layouts, behaviours, renderers, metrics, controls }`. `GraphView` registers `defaultExpanders()`, `defaultLayouts()`, `defaultBehaviours()`, `defaultMetrics()` and `defaultControls()`. It reads its `reified` prop one time, so a change to it needs a new mount.

| Kind | Ids that WE ships | Package |
|---|---|---|
| Seed source (`seeds.source`) | `query`, `schema`, `dataset`, `canvas`, `vocabulary` | `@we/graph-expanders` |
| Expander (`expansion.expanders`) | `entity`, `collection`, `schema`, `schema-instances`, `schema-properties`, `property`, `property-values`, `vocabulary`, `vocabulary-records` | `@we/graph-expanders` |
| Layout (`layout.type`) | `force`, `tree`, `forest`, `radial`, `grid`, `manual` | `@we/graph-layouts` |
| Behaviour (`behaviours`) | `pan-zoom`, `select`, `marquee-select`, `drag-node`, `arrange-nodes`, `connect-nodes`, `node-double-click`, `canvas-double-click`, `expand-on-click`, `expand-on-double-click` | `@we/graph-core` |
| Control (`controls`) | `zoom-in`, `zoom-out`, `fit` (the default three), `relayout`, `pin`, `lock` | `@we/graph-core` |
| Metric | `degree`, `community`, `field` | `@we/graph-core` |

**Notes on the sets:**
- `entity` follows an instance's relations. `readRelations` reads them, and `reified` lets a record that stands for a relation (with a source and a target) be drawn as one edge.
- `property-values` is `property` with values as shared nodes, for a map where nodes with the same value must meet.
- `schema-instances` opens a model's records node into its instances. It has its own id, so a graph that opens a model into its properties does not also open it into all of its records.
- `force` is iterative and uses d3-force. The other five layouts are deterministic. `forest` and `manual` read `CONTAINMENT_EDGE_TYPES` as parent links.

**The catalogue.** `GRAPH_PLUGIN_CATALOG` in `@we/module-graph` lists each id with its options and an example, and says in which prop each kind is written. The validator uses the placements to refuse a name that does not exist, and the generated context gives authors the list (see [View](view.md)).

</details>

<details><summary>Where in the code</summary>

- [packages/graph-system/core/src/registry.ts](../../../packages/graph-system/core/src/registry.ts): `PluginRegistry`, `GraphPlugins`.
- [packages/graph-system/expanders/src/index.ts](../../../packages/graph-system/expanders/src/index.ts): `defaultExpanders`, and the expander and seed factories.
- [packages/graph-system/layouts/src/index.ts](../../../packages/graph-system/layouts/src/index.ts): `defaultLayouts`.
- [packages/graph-system/core/src/behaviours.ts](../../../packages/graph-system/core/src/behaviours.ts), [controls.ts](../../../packages/graph-system/core/src/controls.ts), [metrics.ts](../../../packages/graph-system/core/src/metrics.ts).
- [packages/module-system/graph/src/catalog.ts](../../../packages/module-system/graph/src/catalog.ts): `GRAPH_PLUGIN_CATALOG`.
- [packages/graph-system/CONVENTIONS.md](../../../packages/graph-system/CONVENTIONS.md): when a need is a plugin and not a flag.

</details>
