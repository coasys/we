# Creating and sharing

`createSpace` makes a new dataset, installs the space schema, and writes the `Space` record and the structure every space has. For a shared space it then calls `share`, which publishes the dataset and records the shared id on the `Space` record. `removeSpace` removes the dataset from this agent.

**Why:** The creator writes the first admin grant and the starting policy before the space is shared, so a shared space never exists without an admin, and a member who joins later never writes a first admin of their own. Sharing runs after the space exists: a failure leaves a local space that works, with a "Try again" toast, not a lost space.

**Parent:** [Spaces](README.md)

<details><summary>How it works</summary>

`createSpace(name, description, access, discovery, avatarFile?, coverImageFile?, location?, sharing?, server?, starterId?)`:

1. `lifecycle.create(name)` makes the dataset. A `shared` space on a backend with no `publish` is refused.
2. `schemas.installSpace` installs the space schema and the module schemas. A refused module is reported, and the others install.
3. `addSpaceToDataset` writes the `Space` record (`uuid` is the dataset id) and its `LocationBlock`, then reads the record back.
4. `writeSpaceStructure` writes the space collection (`Space.root`, a `CollectionBlock` in `feed` mode) and then the starter's records and landmarks.
5. `writeAdminGrant` and `writeStartingPolicy` ([Policy](policy.md)).
6. `datasetStore.trackDataset`, and the space goes into `mySpaces`.
7. `shared`: `share` runs without a wait. `personal` and `listed`: `listInGlobal` runs at once.

`share(space, task)`:

1. It takes the dataset's existing `sharedId`, or calls `lifecycle.publish(uuid, { sharing, server })`. So a retry keeps the first address.
2. `Space.update(..., { url: sharedId })`, then it reads the `DatasetRef` again and tracks it, because the new handle carries the transport for presence and calls.
3. It replaces a `/space/<uuid>` route with `/space/<sharedId>`, so a copied link works for others.
4. A `listed` space is listed in the global dataset.

`listInGlobal` copies the `Space` record into the global dataset (`syncSpaceToParent`). A failure there is logged; the space is not affected.

`removeSpace(uuid)` removes the global listing only if this agent wrote it, then calls `datasetStore.removeDataset`.

</details>

<details><summary>Where in the code</summary>

- [packages/app-shell/src/frameworks/solid/stores/SpaceStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/SpaceStore.tsx): `createSpace`, `addSpaceToDataset`, `writeSpaceStructure`, `share`, `shareSpace`, `listInGlobal`, `removeSpace`.
- [packages/app-shell/src/shared/spaceSync.ts](../../../packages/app-shell/src/shared/spaceSync.ts): `syncSpaceToParent`, `removeSpaceFromParent`.
- [packages/backend-system/shared/src/lifecycle.ts](../../../packages/backend-system/shared/src/lifecycle.ts): `DatasetLifecyclePort.create`, `publish`, `sharingOptions`.

</details>
