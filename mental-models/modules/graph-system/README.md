# Graph system

The graph system draws a graph that is explored lazily: each kind of node knows what is next to it. An **expander** gives the neighbours for the kinds that it claims. The engine does the rest: it removes duplicates, and it controls expansion, collapse, layout and drawing.

**Why:** "Show the whole space", "map these query results", "open this collection's children" and "open an entity into its properties" are one feature, not four. A module that adds a new source of nodes writes an expander, and nothing in the core changes (`graph-system/README.md`).

**Parent:** [Modules](../README.md)

## Parts
- [Protocol](protocol.md): node addresses, the expander contract and the JSON graph spec.
- [Engine](engine.md): the scene and the exploration layers, expansion, collapse and folding.
- [Plugins](plugins.md): the instance registry, and the expanders, seeds, layouts, behaviours and controls that WE ships.
- [View](view.md): `GraphView`, the host binding `GraphHost`, and the graph module with its fragments and catalogue.

<details><summary>How it works</summary>

| Package | What it holds | Depends on |
|---|---|---|
| `@we/graph-protocol` | Contracts only: addresses, expanders, layouts, renderers, behaviours, style rules, the spec. | nothing |
| `@we/graph-core` | The engine: store, expansion state, viewport, spatial index, styles, behaviours. No framework, no backend. | protocol |
| `@we/graph-expanders` | The first-party expanders and seed sources. | protocol |
| `@we/graph-layouts` | `force` (over d3-force), `tree`, `forest`, `radial`, `grid`, `manual`. | protocol, d3-force |
| `@we/graph-solid` | The Solid adapter: DOM nodes, SVG edges, pointer events. | core, expanders, layouts |
| `@we/module-graph` | The feature module: fragments that a template can place, and the plugin catalogue. | module-shared, schema-shared |

Data gets to the graph through a port of three functions that the host supplies (`query`, `defaultDataset`, `models`). The app shell's `GraphHost` binds it. No graph package imports a backend.

</details>

<details><summary>Where in the code</summary>

- [packages/graph-system/](../../../packages/graph-system): `protocol/`, `core/`, `expanders/`, `layouts/`, `frameworks/solid/`.
- [packages/module-system/graph/src/](../../../packages/module-system/graph/src): `@we/module-graph`.
- [packages/graph-system/README.md](../../../packages/graph-system/README.md): the design decisions. [packages/graph-system/CONVENTIONS.md](../../../packages/graph-system/CONVENTIONS.md): what goes in the API, the defaults and the invariants.

</details>
