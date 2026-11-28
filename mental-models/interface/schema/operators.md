# Node operators

A **node operator** is a node whose `type` starts with `$`. It controls structure, not appearance. The renderer owns `$each`, `$if`, `$single`, `$agent`, `$routes`, `$animate` and `$surface`. The app shell rewrites `$part`, `$panels` and `$slot` into ordinary nodes before the tree renders. `RenderSchema` expands `$ref` before it renders the tree ([Schema nodes](nodes.md)).

**Why:** A list, a condition and a route outlet map to the framework's own control flow (`<For>`, `<Show>`), so each renderer implements them once. The host already composes schemas out of registries, so it resolves `$part` and `$slot` as one more step of that composition, and no renderer has to learn them (`moduleParts.ts`).

**Parent:** [Schema language](README.md)

<details><summary>How it works</summary>

| Operator | Props | What it does |
|---|---|---|
| `$each` | `items`, `as` (default `item`) | Renders its first child once per item, with `index` and `prev` (the row before) in the context. A `$query` in `items` becomes a live subscription ([Template queries](../renderer/queries.md)). Rows from a store are kept by `id` when they have one. |
| `$single` | `item`, `as` (default `item`) | Like `$each` for one item. The item updates in place. |
| `$if` | `condition`, `then`, `else`, `enterTransition`, `exitTransition` | Renders the `then` node while `condition` is truthy, else the `else` node. |
| `$agent` | `did`, `as` (default `agent`) | Fetches the profile of an agent through `$identities` and renders its children with the profile in scope. |
| `$routes` | — | Marks where the matched route's children render. |
| `$animate` | `condition`, `scrollReveal`, `scrollLeave`, `scrollPast`, `enterTransition`, `exitTransition` | Runs enter and exit transitions. Its child stays mounted. |
| `$surface` | `as` (default `surface`), `styles` | A container that its content can measure itself against. The innermost surface wins for responsive props, and the context gets its size tier. |
| `$part` | `id`, `subject`, `inputs` | The host puts the part that a module or the host publishes (for example `host.sidebar`) inside a `PartFrame`. A part can name its subject, and the placer can give another one. |
| `$panels` | — | Becomes `PanelLane`: a panel lane in a template ([Panels](../chrome/panels.md)). |
| `$slot` | — | The host fills it with what modules contribute to that slot. |

A value that depends on a condition is a ternary in an expression. A choice between handlers is the `$if` handler token ([Handler tokens](handlers.md)).

</details>

<details><summary>Where in the code</summary>

- [SchemaRenderer.tsx](../../../packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx): `RenderNode`, the operator branches.
- [ConditionalRenderer.tsx](../../../packages/schema-system/frameworks/solid/src/ConditionalRenderer.tsx), [AnimateRenderer.tsx](../../../packages/schema-system/frameworks/solid/src/AnimateRenderer.tsx), [SurfaceRenderer.tsx](../../../packages/schema-system/frameworks/solid/src/SurfaceRenderer.tsx), [keptRows.ts](../../../packages/schema-system/frameworks/solid/src/keptRows.ts).
- [moduleParts.ts](../../../packages/app-shell/src/shared/registries/moduleParts.ts): `resolveParts`, `resolvePartsInRoutes`, `openPart`.
- [hostParts.ts](../../../packages/app-shell/src/shared/registries/hostParts.ts): `HOST_PARTS`, `isHostPart`.
- [slotRegistry.ts](../../../packages/app-shell/src/shared/registries/slotRegistry.ts): slots and `PROTECTED_SLOTS`.
- [packages/schema-system/OPERATORS.md](../../../packages/schema-system/OPERATORS.md): every operator with examples.

</details>
