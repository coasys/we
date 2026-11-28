# In-memory adapter

`@we/backend-inmemory` implements the backend contract over plain JS rows. `createInMemoryBackendPorts(ctx, opts)` returns a full `BackendPorts` bundle with no executor, and `compileEntities` compiles the same manifest that AD4M uses into classes that write objects into arrays.

**Why:** It is the reference adapter. Stores and the boot sequence are tested against real entity behaviour instead of hand-written fakes, because a fake is the first thing that stops matching what it stands in for. Reads run through the shared query engine, so filtering, sorting, paging and relation hydration have one implementation, not two.

**Parent:** [Adapters](README.md)

<details><summary>How it works</summary>

1. `createInMemoryBackendPorts` builds a lifecycle (`createInMemoryLifecycle`), a schema port (`createInMemorySchemaPort`) and declares `CORE_MANIFEST` (or `opts.entities`) as module `core`.
2. `compileEntities(manifest, runtime)` makes one `EntityClassLike` per entity. Each write calls `checkEntityWrite` first ([Write path](../entities/writes.md)). `AssertEntityClassSatisfiesContract` checks at type level that the classes satisfy `EntityStatic`.
3. Sharing is simulated. `publish` mints an `inmemory://` URI. `join` resolves against a registry of published datasets, which a test can fill with `seedShared`. Change handlers fire synchronously on the call that changes the data.
4. The file store keeps file content inline: the address it returns is a `data:` URI.
5. The ephemeral port runs on one `InMemoryBus`. The `presence` option gives seeded peers (`SeededPeer`), which send heartbeats while a scope on that dataset is open.
6. `inMemoryQueryAdapter` lowers through `compileQuery` → `executeQueryIR`. `inMemoryCapabilities` declares the operators `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `nin`, `contains`, `startsWith`, `endsWith` and `exists`, plus boolean combinators, relation filters and scope.
7. `shapes` is `createJsonShapeStore`: a space keeps its own shapes as `Shape` records ([Shapes](../spaces/shapes.md)).
8. `workflows` is `createInMemoryWorkflowPort` (`IN_MEMORY_WORKFLOW_CAPABILITIES`), and `references` is `createInMemoryReferencePort(CORE_MANIFEST)`.
9. `createInMemoryBackend(config)` is a smaller fixture: fixed `tables` and `relations`, read-only entity handles with live queries, and `mutate(fn)` to change rows and notify subscribers.

</details>

<details><summary>Where in the code</summary>

- [packages/backend-system/inmemory/src/lifecycle.ts](../../../packages/backend-system/inmemory/src/lifecycle.ts): `createInMemoryBackendPorts`, `createInMemoryLifecycle`, `createInMemoryAgentSession`, `createInMemorySchemaPort`, `createInMemoryProfileDirectory`, `SeededPeer`.
- [packages/backend-system/inmemory/src/entities.ts](../../../packages/backend-system/inmemory/src/entities.ts): `compileEntities`, `EntityRuntime`, `EntityClassLike`.
- [packages/backend-system/inmemory/src/queryAdapter.ts](../../../packages/backend-system/inmemory/src/queryAdapter.ts): `inMemoryQueryAdapter`, `inMemoryCapabilities`.
- [packages/backend-system/inmemory/src/index.ts](../../../packages/backend-system/inmemory/src/index.ts): `createInMemoryBackend`, `BackendConfig`, `RelationDef`.
- [packages/backend-system/inmemory/src/workflows.ts](../../../packages/backend-system/inmemory/src/workflows.ts), [references.ts](../../../packages/backend-system/inmemory/src/references.ts): the workflow and reference ports.
- [packages/backend-system/inmemory/tests/](../../../packages/backend-system/inmemory/tests): its tests, including the conformance run.

</details>
