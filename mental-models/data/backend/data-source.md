# Data source

The **data source** is the part of the contract that the schema renderer reads data through. `BackendPorts.dataBindings(deps)` returns `RendererDataBindings`: a small set of functions (`$currentDataset`, `$getEntity`, `$getEntityForDataset`, `$queryAdapter`, …) that the host adds to the template's store bag. Each entity handle is an `EntityClass` with `query(dataset, opts)`, which returns a `LiveQuery`, and `findAll(dataset, opts)`.

**Why:** The renderer never imports a backend. These types state exactly what it depends on: a dataset handle that round-trips, and an entity handle with `query` and `findAll`. A `DatasetHandle` is typed `unknown`, so a backend passes its native object (a live perspective proxy on AD4M) and does not rebuild it on every query. Only the host that made a handle reads inside it.

**Parent:** [Backend contract](README.md)

<details><summary>How it works</summary>

1. The template provider calls `dataBindings` with host accessors (`DataBindingDeps`: the current dataset, its entities, profiles, the ephemeral port).
2. A `$query` resolves a dataset handle from `$currentDataset` or a `dataset:` path, and an entity handle from `$getEntityForDataset`.
3. `$queryAdapter` turns the query into the `QueryOptions` this backend reads ([Queries](queries.md)).
4. `EntityClass.query` returns a `LiveQuery<Page<T>>`. `Page` holds `results` and an optional `totalCount`.
5. A `LiveQuery` has `first`, `getSnapshot`, `subscribe` and `dispose`. A `Snapshot` has `status` (`loading`, `ready`, `error`), `data`, `error` and `initial`. The snapshot object changes only when the result or the status changes.
6. `$onError` reports a failure to the host. `model` (a `MutationApi`: `create`, `update`, `delete` by entity name) serves the template actions `record.create`, `record.update` and `record.delete`.

`createLiveQuery`, `combineLiveQueries` and `mapLiveQuery` build, merge and transform live queries. How the renderer uses these bindings belongs to [Interface](../../interface/README.md).

</details>

<details><summary>Where in the code</summary>

- [packages/backend-system/shared/src/dataSource.ts](../../../packages/backend-system/shared/src/dataSource.ts): `DatasetHandle`, `QueryOptions`, `EntityClass`, `MutationApi`, `DataSource`, `QueryAdapter`, `RendererDataBindings`, `RENDERER_BINDING_NAMES`.
- [packages/backend-system/shared/src/liveQuery.ts](../../../packages/backend-system/shared/src/liveQuery.ts): `LiveQuery`, `Snapshot`, `Page`, `createLiveQuery`, `combineLiveQueries`, `mapLiveQuery`.
- [packages/backend-system/shared/src/backendPorts.ts](../../../packages/backend-system/shared/src/backendPorts.ts): `DataBindingDeps`.
- [packages/backend-system/ad4m/src/ad4mAdapter.ts](../../../packages/backend-system/ad4m/src/ad4mAdapter.ts): `createAd4mDataBindings`.
- [packages/app-shell/src/frameworks/solid/providers/TemplateProvider.tsx](../../../packages/app-shell/src/frameworks/solid/providers/TemplateProvider.tsx): where the host calls `dataBindings`.

</details>
