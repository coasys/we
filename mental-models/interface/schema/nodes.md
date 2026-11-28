# Schema nodes

A **schema node** is one object in a template tree: `type`, `props`, `children` (nodes, strings or expressions), and optional `slots`, `slot`, `routes`, `theme`, `styles`, `$localState`, `$queries` and `$defs`. A **template** is a root node with `meta` (`TemplateSchema`). Each node has a permanent `id`.

**Why:** A permanent `id` makes an edit name a node, not a position. An edit can then outlive a change to the tree, and a fork can be compared with its original (`nodeIdentity.ts`). **Definitions** (`$defs` and `$ref`) keep a template self-contained: a subtree that occurs twice is written once inside the template, not cited from a shared library, so everything that renders is still in the document (`definitions.ts`).

**Parent:** [Schema language](README.md)

<details><summary>How it works</summary>

| Field                     | Meaning                                                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `type`                    | registry name, `we-*` tag, allowed HTML element, or a node operator ([Node operators](operators.md)); absent: children render with no wrapper                                                                                  |
| `props`                   | values, expressions and handler tokens ([Expressions](expressions.md), [Handler tokens](handlers.md))                                                                                                                          |
| `children`                | nodes, text strings, or `{ $: '…' }` rendered as text                                                                                                                                                                          |
| `slots` / `slot`          | named slots of a component, and the slot a child goes into                                                                                                                                                                     |
| `routes`                  | `RouteSchema` entries (`path`, `redirect`, `keepAlive`); `$views` marks where a space's views go ([Views](../templates/views.md))                                                                                              |
| `theme`                   | theme overrides for this subtree, written as CSS variables on a `display: contents` wrapper                                                                                                                                    |
| `styles`                  | inline CSS on a wrapper element around the node                                                                                                                                                                                |
| `$localState`, `$queries` | local signals and hoisted queries, read as `local.<name>`                                                                                                                                                                      |
| `meta` (root)             | `name`, `description`, `icon`, `role` (`shell`, `view`, `app`, `page`), `segment`, `keepAlive`, `panels`, `chromeReserve`, `frame`, `edges`, `themeId`, `themeIds`, `draws`, `recordViews`, `requires`, `stores`, `components` |

**Node identity.** An id is ten characters. A node made in the editor gets a random (minted) id. A node of a built-in template gets an id derived from the template id and the node's path, so the same build gives the same ids.

**Definitions.**

1. `compactDefinitions` finds subtrees that occur more than once, byte-identical. It moves each into the root's `$defs` and leaves `{ type: '$ref', props: { def } }` at each use.
2. `expandDefinitions` is the exact inverse. `RenderSchema` and `validateSchema` expand first, so no other rule needs to know about `$ref`.
3. `splitUse` gives one use its own copy of the subtree, so an edit to it does not reach the other uses. `useCountOf` tells how many uses an edit reaches.

</details>

<details><summary>Where in the code</summary>

- [types.ts](../../../packages/schema-system/shared/src/types.ts): `SchemaNode`, `TemplateSchema`, `TemplateMeta`, `RouteSchema`, `LocalStateField`.
- [zodSchemas.ts](../../../packages/schema-system/shared/src/zodSchemas.ts): `zSchemaNode`, `zTemplateSchema` (requires `meta`), `zRouteSchema`.
- [nodeIdentity.ts](../../../packages/schema-system/shared/src/nodeIdentity.ts): `newNodeId`, `derivedNodeId`, `deriveNodeIds`.
- [definitions.ts](../../../packages/schema-system/shared/src/definitions.ts): `REF_TYPE`, `compactDefinitions`, `expandDefinitions`, `splitUse`, `useCountOf`, `definitionHolding`.
- [treeUtils.ts](../../../packages/schema-system/shared/src/treeUtils.ts), [mutations.ts](../../../packages/schema-system/shared/src/mutations.ts): tree walks and patches.

</details>
