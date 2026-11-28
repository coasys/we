# Protocol

`@we/graph-protocol` holds only contracts: the node address, the expander and seed-source contracts, and `GraphSpec`, the JSON that a template writes. It has no dependencies, and its types erase at build time.

**Why:** Each node has one stable string address, and the core treats it as opaque. Thus nodes from different expanders merge into one, positions can persist, and one graph can show records from two datasets (`graph-system/README.md`). The spec is all JSON, because a template is data and a value that only a function can give is a value that no community member can write. Where code is necessary, the spec names a registered plugin (`spec.ts` header).

**Parent:** [Graph system](README.md)

<details><summary>How it works</summary>

**Addresses** (`address.ts`). Only this file makes and parses addresses: `entityAddress`, `propertyAddress`, `literalAddress`, `datasetAddress`, `clusterAddress`, `resourceAddress`, `parseAddress`, `addressKind`. The `NodeKind` values are:
- `entity`: an instance of an entity type in a dataset.
- `property`: one property of one instance, as a node.
- `literal`: a scalar value. All property nodes with the same value share it, so they come together on one node.
- `dataset`: a space or a neighbourhood.
- `cluster`: a group that the engine made, for example a collapsed subtree.
- `resource`: a URI with no model.

**The expander** (`expander.ts`). `Expander{ id, kinds, types?, priority?, description?, expand(request, context) }`. The `kinds` and `types` decide which nodes it expands. When several expanders claim a node, all of them run and their results merge by address. `priority` decides which one is primary.
- `ExpandRequest{ id, direction (out, in, both), limit?, cursor?, edgeTypes?, signal? }`.
- `ExpandResult` is a `GraphFragment` (nodes and edges) with `total?` and `cursor?`. An unknown `total` is shown as unknown, not as the page size.
- `ExpanderContext` is the port: `query`, `defaultDataset`, `models`, and the optional `watch` and `watchRead`, `warn` and `trace?`. It holds ports only, never a host object or a backend SDK. An expander that cannot answer calls `warn` and does not throw.
- `SeedSource` gives the nodes that a graph starts with. It has the shape of an expansion without the node to expand.
- `GraphNode.unresolved` marks a placeholder: a target that has not synced yet, which is not the same as no target.
- `CONTAINMENT_EDGE_TYPES` (`contains`, `property`, `value`, `instance`) are the edges that layouts read as parent links.

**The spec** (`GraphSpec`):

| Field | What it says |
|---|---|
| `seeds` | `{ literal: true, nodes, edges }` for a fixed diagram, or `{ source, options }` for a named seed source. |
| `expansion` | `defaultDepth`, `direction`, `limit`, `expanders`, `edgeTypes`, `auto` rules, and `maxNodes`, the ceiling on nodes held at one time. |
| `layout` | `{ type, options }`: a registered layout. |
| `nodeStyle`, `edgeStyle` | Style rules (`style.ts`). |
| `behaviours`, `controls` | Registered behaviour and control ids. |
| `viewport` | The start camera. |
| `live` | Read the seeds again when their records change. On by default where the host can report changes. Set it to `false` for a graph that must not change while it is shown. |

`layout.ts` and `render.ts` hold the `Layout`, `NodeRenderer`, `Behaviour`, `GraphControl` and `Metric` contracts.

</details>

<details><summary>Where in the code</summary>

- [packages/graph-system/protocol/src/](../../../packages/graph-system/protocol/src): `address.ts`, `expander.ts`, `graph.ts`, `spec.ts`, `layout.ts`, `render.ts`, `style.ts`.

</details>
