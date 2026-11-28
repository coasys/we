# Schema language

A template is a tree of **schema nodes**. Each node names a `type` and carries `props`, `children` and optional `slots`, `routes`, `theme` and local state. A prop value is literal data, an **expression** `{ $: '…' }`, or a **handler token** such as `$invoke`. A `type` that starts with `$` is a **node operator** that controls structure.

**Why:** All schema semantics live in `@we/schema-shared`, which has no framework import. The validator, the editor, the AI context and every renderer read the same rules. A renderer for a framework only supplies its signal primitive ([Renderer](../renderer/README.md)). The value layer is one closed grammar, so a plain string is always text and a reference is always an expression. The validator reports a string such as `'$item.name'` as an error, because it renders as text (`semanticValidation.ts`).

**Parent:** [Interface](../README.md)

## Parts
- [Schema nodes](nodes.md): the node fields, the root `meta`, node identity, and shared definitions (`$defs` and `$ref`).
- [Expressions](expressions.md): the `{ $ }` grammar, its roots and its function library.
- [Handler tokens](handlers.md): `$invoke`, the local-state tokens and the `$if` handler, plus `$localState`.
- [Node operators](operators.md): `$each`, `$if`, `$single`, `$routes`, `$animate`, `$surface`, `$agent`, and the host's `$part`, `$panels` and `$slot`.
- [Validation](validation.md): structural and semantic checks, and the CLI audits.

<details><summary>How it works</summary>

`resolveProp(value, stores, context, memo)` in [dispatcher.ts](../../../packages/schema-system/shared/src/propResolvers/dispatcher.ts) is the one entry for a prop value:

| Value | Resolved by |
|---|---|
| `{ $: '…' }` | `resolveExpressionProp` (expression.ts) |
| `{ $setLocal }`, `{ $touch }`, `{ $resetLocal }`, `{ $toggleLocal }`, `{ $toggleLocalIn }`, `{ $callLocal }` | local.ts |
| `{ $invoke }` | `resolveInvokeProp` (invoke.ts) |
| `{ $if: { … } }` | `resolveIfHandler` (conditional.ts) |
| `{ $query }` | the renderer ([Template queries](../renderer/queries.md)) |
| array, plain object | each element or key, recursively (depth limit 10) |
| string, number, boolean, function | unchanged |

A key of the form `onX` with an array value becomes one function. That function resolves each array item when the event fires, with `event` in the context.

</details>

<details><summary>Where in the code</summary>

- [packages/schema-system/shared/src/](../../../packages/schema-system/shared/src): `@we/schema-shared`.
- [propResolvers/](../../../packages/schema-system/shared/src/propResolvers): `resolveProp`, `resolveProps`, the token resolvers, `markReactive`.
- [types.ts](../../../packages/schema-system/shared/src/types.ts): `SchemaNode`, `TemplateSchema`, `RouteSchema`, `TemplateMeta`.
- [packages/schema-system/README.md](../../../packages/schema-system/README.md), [OPERATORS.md](../../../packages/schema-system/OPERATORS.md), [CONVENTIONS.md](../../../packages/schema-system/CONVENTIONS.md): the depth.

</details>
