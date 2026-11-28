# Entity proxies

An **entity proxy** is the object that `@we/entities` exports for each entity name (`Space`, `TextBlock`, …). `defineEntity(name)` returns a `Proxy` that forwards every access to `getEntity(name)`: the class that the connected backend registered under that name.

**Why:** Consumers keep the entity calls (`Space.findAll(dataset, …)`, `record.save()`, `include` projections) with no backend import. Resolution happens at call time, so a missing implementation is a runtime error. The proxy makes that error loud: it names the entity and says that no backend registered it. A proxy forwards operations but not identity: decorator metadata and any `WeakMap` keyed by the class find nothing on the proxy. So code that passes an entity class to a backend's own API lives in that backend package.

**Parent:** [Entities](README.md)

<details><summary>How it works</summary>

1. The adapter calls `registerEntity(name, cls)` for each class at startup. The registry maps live on `globalThis`, so the package's entry points share one registry even when a bundler gives each entry its own module scope.
2. A call on the proxy (`Space.create(dataset, data)`) resolves `getEntity('Space')` and forwards. The instances that come back are the backend's own.
3. A dataset can also carry entities that are not WE-native: foreign SDNA, or the space's own shapes. `registerDynamicEntities(datasetId, models)` replaces the dataset's map. `mergeDynamicEntities` adds to it.
4. `getEntityForDataset(name, dataset)` prefers the global (native) class, and falls back to the dataset's map. It returns `undefined` instead of throwing.
5. `getEntityPredicates`, `getEntityTargetClass` and `getEntityNameByTargetClass` read a class's generated shape.

The typed static surface of a proxy is `EntityStatic<T>`: `create`, `findAll`, `findOne`, `update`, `delete`, `count`, `query`.

</details>

<details><summary>Where in the code</summary>

- [packages/entities/src/entityProxy.ts](../../../packages/entities/src/entityProxy.ts): `defineEntity`.
- [packages/entities/src/entityRegistry.ts](../../../packages/entities/src/entityRegistry.ts): `registerEntity`, `unregisterEntity`, `getEntity`, `getRegisteredEntityNames`, `registerDynamicEntities`, `mergeDynamicEntities`, `getEntityForDataset`.
- [packages/entities/src/index.ts](../../../packages/entities/src/index.ts): the exported proxies, typed as `EntityStatic<…Record>`.
- [packages/backend-system/shared/src/recordContract.ts](../../../packages/backend-system/shared/src/recordContract.ts): `EntityStatic`, `TypedEntityQuery`, `RECORD_TYPE_KEY`.
- [packages/backend-system/ad4m/src/backendPortsAdapter.ts](../../../packages/backend-system/ad4m/src/backendPortsAdapter.ts): where the AD4M adapter registers its classes.

</details>
