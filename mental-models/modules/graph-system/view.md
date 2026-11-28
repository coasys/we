# View

`GraphView` (`@we/graph-solid`) is the Solid component that draws a graph. Its props are the graph spec, plus size, empty-state and event props. The app shell's `GraphHost` wraps it and gives it the data. The graph module (`@we/module-graph`) lends `GraphView` to templates and adds four ready graphs as parts.

**Why:** Only `GraphHost` knows both the graph and the backend. The graph must be portable, and how one deployment reads data must not go with it (`GraphHost.tsx` header). The module takes the component as an argument and does not import it, so its bundle does not have a second copy of Solid. The graph has no store, because open nodes, the camera and the selection belong to each view. A store would make two graphs on one page share one expansion state (`module-system/graph/src/index.ts` header).

**Parent:** [Graph system](README.md)

<details><summary>How it works</summary>

**`GraphView`** makes a `PluginRegistry` and a `GraphEngine` for each mount (see [Plugins](plugins.md) and [Engine](engine.md)). It draws nodes as DOM elements and edges as SVG. Its props:
- The spec: `seeds`, `expansion`, `layout`, `nodeStyle`, `edgeStyle`, `behaviours`, `controls`, `live`, and `reified`.
- How it looks: `width`, `height`, `bg`, `backdrop`, `showStatus`, `showControls`, and the empty state (`empty`, `emptyIcon`, `emptyAction`).
- Events: `onNodeClick`, `onNodeDoubleClick`, `onEdgeClick`, `onEdgeCreate`, `onSelectionChange`, `onNodeDragEnd`, `onNodeArrange`, `onDrop`, `onNodeAction`, and others. `focus` selects a node from outside.
- `host`: the data bindings. The host's component registry supplies them, and a template never writes them.

**`GraphHost`** (app shell):
- It builds the `ExpanderContext` port from `sessionStore.backendPorts().dataBindings(…)`, with the current dataset, its entities and the profiles.
- It follows live reads for the `live` spec (`graphWatch.ts`).
- It imports the graph's stylesheet. `@we/graph-solid` ships the stylesheet as a separate entry. Without it, the graph is in the DOM but nothing is visible.
- The component registry has `GraphView: GraphViewOnDemand`, which loads `GraphHost` only when a template draws a graph.

**The graph module** (`createGraphModule(graphViewComponent)`, id `graph`):
- `requires: { frameworks: ['solid'] }`, because the component is Solid. It names no backend, because all reads go through the host's port.
- `components: { GraphView }`. No store and no entities.
- Parts: `schemaMap` (the space's entity types and their relations, `schema` seed, `force`), `contentTree` (collections as a `tree`), `staticDiagram` (a fixed three-step diagram with a literal seed) and `knowledgeMapPosts` (`knowledgeMap({ entity: 'Post' })`, a `query` seed that opens on double-click).
- `GRAPH_PLUGIN_CATALOG` gets into the generated context through `context: { type: 'plugins' }` in the package's `package.json`.

</details>

<details><summary>Where in the code</summary>

- [packages/graph-system/frameworks/solid/src/](../../../packages/graph-system/frameworks/solid/src): `GraphView.solid.tsx`, `GraphView.types.ts`.
- [packages/app-shell/src/frameworks/solid/components/GraphHost.tsx](../../../packages/app-shell/src/frameworks/solid/components/GraphHost.tsx), [packages/app-shell/src/shared/graphWatch.ts](../../../packages/app-shell/src/shared/graphWatch.ts).
- [packages/app-shell/src/frameworks/solid/registries/moduleComponents.tsx](../../../packages/app-shell/src/frameworks/solid/registries/moduleComponents.tsx): `GraphViewOnDemand`.
- [packages/module-system/graph/src/index.ts](../../../packages/module-system/graph/src/index.ts), [fragments.ts](../../../packages/module-system/graph/src/fragments.ts), [catalog.ts](../../../packages/module-system/graph/src/catalog.ts).
- How a part is placed in a template: the [Interface](../../interface/README.md) branch.

</details>
