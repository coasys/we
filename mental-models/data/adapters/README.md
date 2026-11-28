# Adapters

An **adapter** implements the [backend contract](../backend/README.md) for one backend. WE has two: `@we/backend-ad4m`, which the app runs on, and `@we/backend-inmemory`, the reference implementation over plain JS arrays. Both run one shared conformance suite, `@we/backend-conformance`.

**Why:** Only an adapter may know a backend's native types: `@we/backend-ad4m` is the one package that knows what a `PerspectiveProxy` is. The in-memory adapter exercises the same renderer path with no executor, so a change that breaks the contract fails there first, in milliseconds, and the stores are testable without a backend process. The conformance suite holds both adapters to the same behaviour.

**Parent:** [Data](../README.md)

## Parts

- [AD4M adapter](ad4m.md): `createAd4mBackendPorts`, the AD4M classes, SDNA install, the query adapter and the patches on `Ad4mModel`.
- [In-memory adapter](inmemory.md): `createInMemoryBackend`, `createInMemoryBackendPorts`, and the reference query adapter.
- [Conformance suite](conformance.md): `describeBackendConformance`, the harness, known gaps.

<details><summary>How it works</summary>

| Contract part  | AD4M                                                                                   | In memory                                          |
| -------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------- |
| ports          | `createAd4mBackendPorts`                                                               | `createInMemoryBackendPorts`                       |
| entity classes | generated classes in `src/entities/`, plus classes compiled from a manifest at runtime | `compileEntities` over in-memory tables            |
| query adapter  | `createAd4mQueryAdapter`, `ad4mCapabilities`                                           | `inMemoryQueryAdapter`; reads run `executeQueryIR` |
| sharing        | `publish`/`join` on neighbourhoods                                                     | simulated: `publish` mints an `inmemory://` URI    |
| ephemeral      | `createAd4mEphemeralPort`                                                              | `createInMemoryEphemeralPort`                      |
| shapes         | `createAd4mShapeStore` (SHACL)                                                         | `createJsonShapeStore` (`Shape` records)           |

The host picks the adapter through its [backend connector](../../hosts/platform/backend-connector.md).

</details>

<details><summary>Where in the code</summary>

- [packages/backend-system/ad4m/](../../../packages/backend-system/ad4m): the AD4M adapter and its [README.md](../../../packages/backend-system/ad4m/README.md).
- [packages/backend-system/inmemory/](../../../packages/backend-system/inmemory): the in-memory adapter and its [README.md](../../../packages/backend-system/inmemory/README.md).
- [packages/backend-system/conformance/](../../../packages/backend-system/conformance): the suite.

</details>
