# Queries

A **query** is a `$query` token: a backend-neutral question for records of an `entity`, with `where`, `order`, `limit`, `offset`, `include`, `select`, `scope`, `dataset` and `when`. The renderer turns it into a live subscription. A query can be a prop value, the `items` of `$each` or `$single`, or an entry of `$queries` on a node.

**Why:** A backend pays for each live question separately, so the renderer keeps one subscription per distinct question, however many nodes ask it. The pool keys a question by the entity name, the dataset id and the question as JSON, not by the object that asks (`subscriptionPool.ts`). `$queries` hoists a query to a node, so one answer serves the whole subtree as `local.<name>`.

**Parent:** [Renderer](README.md)

<details><summary>How it works</summary>

1. `resolveQueryProp` reads the token into a descriptor. `createQuerySignal` runs it inside an effect.
2. The effect reads `$getEntity` and `$currentDataset` (or the store path in `dataset`) from the template bag. Until they exist, the result is empty. When they arrive, the effect runs again.
3. Expressions inside the question (`where`, `limit`, `scope.anchorId`, a computed `entity`) resolve inside the effect, so a change to one of them asks again. While `when` is falsy, the query is not asked.
4. `acquireSubscription` returns the shared subscription. A subscription that nobody holds stays open for `subscriptionPoolConfig.releaseGraceMs` (1500 ms), so a question asked again soon reuses it.
5. Rows reconcile by `id` into a Solid store, so a changed row updates in place.
6. Each `$queries` entry gives `local.<name>` and `local.<name>Loaded`. `Loaded` is false until the first result or error. A query can read the result of another query on the same node, in any order. Fields from `$queries` are read-only.

An `entity` list asks the same question of each entity and gives one list, with each row tagged by `__subjectClass`. What the backend does with the question: [Data](../../data/README.md).

</details>

<details><summary>Where in the code</summary>

- [SchemaRenderer.tsx](../../../packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx): `createQuerySignal`, the `$queries` block.
- [subscriptionPool.ts](../../../packages/schema-system/frameworks/solid/src/subscriptionPool.ts): `acquireSubscription`, `subscriptionPoolConfig`, `resetSubscriptionPool`.
- [propResolvers/query.ts](../../../packages/schema-system/shared/src/propResolvers/query.ts): `resolveQueryProp`.
- [types.ts](../../../packages/schema-system/shared/src/types.ts): `QueryToken`, `QueryStateField`.
- [expressions/where.ts](../../../packages/schema-system/shared/src/expressions/where.ts): the `where` grammar.

</details>
