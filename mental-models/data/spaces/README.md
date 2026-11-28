# Spaces

A **space** is a community or a context, backed by one dataset, with a `Space` record in that dataset that describes it. A **personal** space is a local dataset. A **shared** space is a published dataset (a neighbourhood on AD4M), and its `Space` record's `url` is the shared id. `SpaceStore` creates, shares, joins and removes spaces, and holds the members, the shapes and the write check.

**Why:** The data of a space lives in the space's own dataset, so a member keeps it, and changing the interface never touches it. The `Space` record lives in the same dataset, so every member reads the same name, sections, modules and defaults. A space's own choices (for example `enabledModules` and `enabledViews`) are facts about the space, so they are on the record; an agent's own choices are in its `SpacePreference` in we-root.

**Parent:** [Data](../README.md)

## Parts
- [Creating and sharing](create.md): `createSpace`, `share`, `listInGlobal`, `removeSpace`.
- [Joining](join.md): `joinSpace`, `finishJoin`, `initializeAsWeSpace`.
- [Shapes](shapes.md): where a space keeps the entities its community defines, and `ShapeStore`.
- [Policy](policy.md): who may write what, judged at the write.

<details><summary>How it works</summary>

1. `loadSpaces` reads each joined dataset's own `Space` record (`readSpaceRows`), except the system datasets, into `mySpaces`. A dataset with no `Space` schema gives no row and does not stop the others.
2. `spaceSelfWhere(ds)` finds the record by `url` (the shared id) when the dataset is shared, else by `uuid` (the local dataset id).
3. A listed space also has a copy of its `Space` record in the global dataset (`syncSpaceToParent`, keyed by `uuid`). That copy is only for discovery.
4. Members: after the first screen is open, an effect calls `lifecycle.members(dataset)`, adds this agent's DID, and fetches each profile. `members` is the list of cached `AgentProfileSummary` rows for those DIDs.
5. Empty `enabledModules` or `enabledViews` means "not decided", not "none": the value falls back to the seed's set.

How a space's sections resolve from `enabledViews` belongs to [Interface](../../interface/README.md). Which modules a space turns on, and starters, belong to [Modules](../../modules/README.md).

</details>

<details><summary>Where in the code</summary>

- [packages/app-shell/src/frameworks/solid/stores/SpaceStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/SpaceStore.tsx): `SpaceStore`, `loadSpaces`, `readSpaceRows`, `members`.
- [packages/entities/src/manifest/Space.ts](../../../packages/entities/src/manifest/Space.ts): the `Space` entity.
- [packages/app-shell/src/shared/spaceSync.ts](../../../packages/app-shell/src/shared/spaceSync.ts): `syncSpaceToParent`, `removeSpaceFromParent`, `spaceSelfWhere`, `isSpaceSelf`.
- [docs/architecture/views.md](../../../docs/architecture/views.md): `enabledViews` and `SpacePreference.hiddenViews`.

</details>
