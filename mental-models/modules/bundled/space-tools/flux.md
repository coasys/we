# Flux

The Flux module (`@we/module-flux`) reads one thing from a space that is synced in from the Flux app: the messages in a conversation subgroup. It requires the `ad4m` backend and has one store member, `subgroupMessages(subgroupId)`.

**Why:** A `$query` reaches most of Flux's records through the shapes that Flux installed. A subgroup's items are linked only through `flux://has_item`, which no shape declares, so a `$query` cannot follow them. The question is written in AD4M's query language against Flux's link names. So it belongs in a module that says which backend it needs, and not on the backend contract that every backend implements (`index.ts` header).

**Parent:** [Space tools](README.md)

<details><summary>How it works</summary>

- `subgroupMessages(dataset, subgroupId)` runs a SPARQL query on the AD4M perspective. It asks the same question that Flux asks, for messages only, and does not depend on Flux's package. It returns `{ id, author, timestamp, body }` rows, oldest first.
- The store reads the space on screen (`deps.dataset`). Outside a space, or when the read fails, it returns an empty list.
- The member is an `ambient` action, so a template can call it on render and not only from a gesture. The Cards [view](../../../interface/templates/views.md)'s `FluxConversationsNestedList` calls it when a subgroup is expanded for the first time.
- On a host whose backend is not `ad4m`, `checkModuleCompatibility` refuses the module, and the registry does not register it.

</details>

<details><summary>Where in the code</summary>

- [packages/module-system/flux/src/index.ts](../../../../packages/module-system/flux/src/index.ts): `fluxModule`, `createFluxStore`.
- [packages/module-system/flux/src/subgroupMessages.ts](../../../../packages/module-system/flux/src/subgroupMessages.ts): the query and `FluxSubgroupMessage`.
- [packages/templates/views/src/views/CardsView/FluxConversationsNestedList.ts](../../../../packages/templates/views/src/views/CardsView/FluxConversationsNestedList.ts): the template that uses it.
- What `ambient` means: [Store surface](../../contract/store-surface.md).

</details>
