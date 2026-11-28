# Engine

`@we/graph-core` holds the graph's state and changes it. `GraphEngine` reads the seeds, runs the expanders, keeps the expansion state, runs the layout and keeps the scene. It then tells its subscribers what changed. It imports no framework and no backend.

**Why:** With no framework and no backend, a test can run the whole engine with a fake expander and no DOM. Only such a test can find faults in collapse and in the node budget, because these faults are not visible until they occur (`engine.ts` header). The scene and the exploration are two layers, so a canvas uses the scene without the expansion state, and an explorer does not get undo and marquee selection (`graph-system/README.md`).

**Parent:** [Graph system](README.md)

<details><summary>How it works</summary>

**Two layers:**
- **Scene**: `Viewport`, `SpatialIndex`, selection, positions and `foldGraph`. These draw a set of placed nodes and let a reader use them. They do not know where the nodes came from.
- **Exploration**: `GraphStore`, `ExpansionState` and `GraphEngine`. These run the expanders, keep the expansion state, collapse, bundle edges and keep the node budget.

**The engine's API:** `subscribe(listener)` (the reason is, for example, `graph`, `positions` or `viewport`), `setSpec`, `start`, `refresh`, `expand(id, direction?, expanders?)`, `collapse`, `toggle`, `setFolded`, `relayout`, `setLive` and `dispose`. `getStatus()` gives `loading`, `reloading`, `budgetReached` and `warnings`.

**Expansion is paged and has a budget.** A hub with thousands of neighbours must not stop the frame. When the engine gets to `maxNodes`, it stops expanding and shows this in the status strip. It does not remove nodes without a message.

**Collapse** (`ExpansionState`):
- Collapse is reference-counted. Each node records which open nodes put it on the graph. A collapse removes only the nodes that no other open node holds. A seed node has the opener `SEED_OPENER`, so it stays after every collapse.
- Collapse bundles edges. An edge that crossed the collapse boundary attaches again to the collapsed node, as one weighted edge. A cluster is a collapsed node that the engine made.

**Folding is not collapsing** (`fold.ts`, `setFolded`). A collapse removes nodes from the store. A fold keeps all nodes loaded and hides some of them. The engine does not query or lay out the nodes again, and an unfold puts each card back where it was. A hidden node has no position, so it has no hit area, no lines and is not drawn.

**Hit-testing is in the core.** Behaviours get world coordinates and ask the engine (`SpatialIndex`) which node is there. They do not use DOM events, so a renderer that is not DOM can use the same behaviours.

</details>

<details><summary>Where in the code</summary>

- [packages/graph-system/core/src/](../../../packages/graph-system/core/src): `engine.ts` (`GraphEngine`), `expansion.ts` (`ExpansionState`), `store.ts` (`GraphStore`), `fold.ts`, `viewport.ts`, `spatial.ts`, `style.ts`, `metrics.ts`.
- [packages/graph-system/CONVENTIONS.md](../../../packages/graph-system/CONVENTIONS.md): the invariants.

</details>
