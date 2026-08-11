# The graph system

A general-purpose graph engine: knowledge maps, schema maps, hierarchies, cluster maps, static
diagrams — and, later, free-positioned boards. One engine, configured as data.

## The idea in one paragraph

"Show the whole perspective", "map these query results", "open this collection's children", "zoom a
model out into its properties" and "explore spaces and neighbourhoods" are not five features. They
are one: **a lazily-explored frontier over a heterogeneous source space**, where each *kind* of node
knows what is adjacent to it. An **expander** answers that question for the kinds it claims, and the
engine does the rest — dedup, expansion state, collapse, layout, rendering. A module adding a new
source of nodes writes an expander and nothing in the core changes.

## Packages

| Package | Role | Depends on |
|---|---|---|
| `@we/graph-protocol` | Contracts only — addressing, expanders, layouts, renderers, behaviours, style rules, the JSON spec. Erases at build time. | nothing |
| `@we/graph-core` | The engine: store, expansion state, viewport, spatial index, styling, behaviours. No framework, no backend. | protocol |
| `@we/graph-expanders` | First-party expanders and seed sources. | protocol |
| `@we/graph-layouts` | Force (d3-force), tree, radial, grid, manual. | protocol, d3-force |
| `@we/graph-solid` | The Solid adapter — DOM nodes, SVG edges, pointer plumbing. | core, expanders, layouts |
| `@we/module-graph` | The feature module: placeable fragments and the plugin catalog. | module-shared, schema-shared |

Data reaches the graph through a three-function port the host supplies
(`query` / `defaultDataset` / `models`), bound in `app-shell`'s `GraphHost`. Nothing in these packages
imports a backend.

## Two layers, deliberately

- **Scene** — `Viewport`, `SpatialIndex`, selection, positions. Everything needed to draw and interact
  with a set of placed nodes, knowing nothing about where they came from.
- **Exploration** — `GraphStore`, `ExpansionState`, `GraphEngine`. Expanders, expansion state,
  reference-counted collapse, bundling, budgets.

A board uses the scene and none of the exploration. A knowledge map uses both. Keeping them apart is
what stops a board dragging in expansion state it has no use for, and stops undo and marquee selection
leaking into an explorer that will never want them.

**Before extending any of this, read [`CONVENTIONS.md`](./CONVENTIONS.md)** — what belongs in the API
and what does not, why the defaults are what they are, and the invariants that have already been
broken once each.

## Decisions worth knowing before changing anything

**Node addressing is the load-bearing decision.** Every node — an entity, one of its properties, a
literal value, a dataset, a cluster — has a single stable string address, minted and parsed only in
`protocol/src/address.ts`. The core treats it as opaque. This is what lets nodes from different
expanders dedupe against each other, lets positions persist, and lets a graph span two datasets. If
addresses had started as bare entity ids, the holonic explorer would be a rewrite rather than a
sixth expander.

**Hit-testing belongs to the core, not the DOM.** With DOM nodes the browser will tell you what was
clicked, and writing behaviours against DOM events is the obvious thing to do. It is also the one-way
door: a canvas renderer has no elements to hit. Behaviours receive world coordinates and ask the
engine what is there, so a dense canvas mode stays additive.

**Collapse is reference-counted and bundles rather than hides.** A node reachable from two open
parents must survive closing one of them; and edges that crossed a collapse boundary re-attach to the
collapsed node as a weighted bundle, so the view says "twelve things in here relate to that" instead
of showing an isolated dot. That mechanism is also all a cluster map needs — a cluster is a collapsed
synthetic node.

**Expansion is paged and budgeted.** One click on a hub with four thousand neighbours must not be able
to kill the frame. `ExpandResult.total` is reported so the UI can say what it is not showing, and the
node ceiling surfaces in the status strip rather than truncating in silence.

**The authoring surface is JSON, and the plugin registry is the escape hatch.** Everything a template
writes is data; anything genuinely computational — a new traversal, a new layout, a metric to size by
— is a registered plugin named from data with parameters. Same bargain templates make with components,
one level down. Which is why `@we/module-graph/src/catalog.ts` matters: a plugin that is not in the
generated AI context is a plugin nobody can name.

**Placeholders are a first-class state.** In a peer-to-peer system, a relation target that has not
synced or a space nobody has joined is the normal case, not an error. `GraphNode.unresolved` is the
difference between "not here yet" and "nothing there", and without it every expander invents its own.

## What is deliberately not here

- **Boards.** The engine supports manual layout and a board is the obvious next mode, but a freeform
  canvas is its own project — undo, marquee, snapping, z-order, text editing on a transformed surface
   — and it needs durable entities this module does not yet declare.
- **A dense canvas renderer.** The node-renderer registry and core-owned hit-testing exist so it can
  be added without touching the plugins; nothing needs it yet.
- **Graph algorithms.** Community detection and centrality are what `MetricRef` points at. They should
  project the visible graph out to a library on demand rather than being hand-rolled here.
- **A raw-link expander.** The true triple-level view of a perspective needs a neutral traversal port
  (`links({ source?, predicate?, target? })`) with the backend declaring its own internal predicate
  namespaces, or it will render mostly plumbing.

## Backward traversal, and the one honest weak spot

"What points at this?" is half of what makes a map explorable. WE's relations are one-directional —
the neutral manifest does not emit `reverseOf` and the query IR walks forward — so the entity expander
asks for it through the drill-down path with `direction: 'in'`.

`GraphHost` currently answers that with a **capped scan** and says so in the graph's status strip. The
real fix is a target-side query in the AD4M adapter: `?source <predicate> <target>` is a single SPARQL
pattern, `scope` already resolves a relation to its predicate, and the ids can be hydrated back through
the existing `findAll` path. When that lands, `REVERSE_SCAN_LIMIT` and the scan go together.
