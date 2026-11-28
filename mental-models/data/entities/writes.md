# Write path

Every record write — a create, an edit, a delete, a relation add or remove — passes one **write check** before the backend makes it. `@we/entities` holds three slots for this: the host registers the write check (`registerEntityWriteCheck`), and the backend registers a transaction runner (`registerTransactionRunner`) and a file store (`registerFileStore`).

**Why:** A store, a template's `record.*` call, a module and a relation accessor all write. Each backend calls `checkEntityWrite` from its own write path, so no caller can reach a write that skips it, and nothing above the backend has to remember to. The decision is the host's, because only the host knows which dataset is a space, who is signed in and which roles they hold. Transactions and file storage are backend facts that the manifest does not carry.

**Parent:** [Entities](README.md)

<details><summary>How it works</summary>

1. A caller writes through an entity proxy, for example `TextBlock.create(dataset, data)`.
2. Before it writes, the backend builds an `EntityWrite` {`dataset`, `entity`, `kind`, `id`, `relation`, `data`, `record`} and awaits `checkEntityWrite`. `record` is lazy: the check reads the record only when its rule needs it.
3. The registered check resolves, or rejects with the reason. A rejection stops the write. With no check registered, every write goes ahead.
4. `runEntityTransaction(dataset, fn, join?)` runs `fn` as one write group. On AD4M the runner is `Ad4mModel.transaction`. The default runner is a passthrough: each write commits on its own. `join` runs inside an open batch, so two writes that make one act land as one commit.
5. A property with `format: 'file'` stores its content through `getFileStore()`. With no file store, callers keep the content inline.

| Backend | Where it calls `checkEntityWrite` |
|---|---|
| AD4M | `installWriteChecks(Ad4mModel)` patches `save`, `delete`, `addRelationValue`, `removeRelationValue`, `setRelationValues` |
| In memory | each write method that `compileEntities` builds |

The check that WE registers judges the space's policy: see [Policy](../spaces/policy.md).

</details>

<details><summary>Where in the code</summary>

- [packages/entities/src/entityRegistry.ts](../../../packages/entities/src/entityRegistry.ts): `EntityWrite`, `EntityWriteCheck`, `registerEntityWriteCheck`, `checkEntityWrite`, `registerTransactionRunner`, `runEntityTransaction`, `registerFileStore`, `getFileStore`.
- [packages/backend-system/ad4m/src/writeChecks.ts](../../../packages/backend-system/ad4m/src/writeChecks.ts): `installWriteChecks`.
- [packages/backend-system/ad4m/src/backendPortsAdapter.ts](../../../packages/backend-system/ad4m/src/backendPortsAdapter.ts): the transaction runner and the file store on AD4M.
- [packages/backend-system/inmemory/src/entities.ts](../../../packages/backend-system/inmemory/src/entities.ts): `compileEntities`.

</details>
