# Data

The Data branch covers what WE stores and how the app reads and writes it. **Entities** are declared once in a neutral manifest. The **backend contract** defines the ports that every backend implements. **Adapters** implement the contract for AD4M and in memory. **Stores** hold the reactive state that templates read, and **spaces** are datasets that a `Space` record describes.

**Why:** The renderer, the design system and the module contract do not import `@coasys/*`. They speak only to the contract in `@we/backend-shared` and to the entity proxies in `@we/entities`. Thus a template, a component or a feature module does not know which backend holds the data. A second backend (`@we/backend-inmemory`) runs the same conformance suite as the AD4M adapter. That suite keeps the contract honest.

**Parent:** [WE](../README.md)

## Parts

- [Entities](entities/README.md): the record types, the manifest that declares them, and the write path.
- [Backend contract](backend/README.md): `BackendPorts`, the data source, datasets, schemas, queries and the ephemeral ports.
- [Adapters](adapters/README.md): the AD4M and in-memory implementations of the contract, and the conformance suite.
- [Stores](stores/README.md): the Solid stores that hold reactive state, and how a template reaches them.
- [Spaces](spaces/README.md): datasets that hold a `Space` record; creating, sharing, joining, their own shapes, and their policy.

<details><summary>How it works</summary>

```
template ($query, { $ }, $invoke)
   │                         Interface branch
   ▼
stores (SessionStore, DatasetStore, SpaceStore, …)      ── Stores
   │  entity proxies (Space, TextBlock, …)               ── Entities
   ▼
BackendPorts (lifecycle, schemas, dataBindings, ephemeral, …)  ── Backend contract
   │
   ▼
@we/backend-ad4m  |  @we/backend-inmemory              ── Adapters
```

1. A host supplies a backend connector. The connector builds one `BackendPorts` object for the session.
2. The adapter registers one class for each entity name. The proxies that `@we/entities` exports forward to those classes.
3. The stores call the ports and the proxies. A template reaches the stores only through the members it is granted.
4. Every record write goes through one write check, which judges the space's policy.

For the schema renderer and templates, see [Interface](../interface/README.md). For feature modules and their entities, see [Modules](../modules/README.md). For boot, see [Boot](../hosts/boot/README.md); for the backend connectors, see [Backend connector](../hosts/platform/backend-connector.md).

</details>

<details><summary>Where in the code</summary>

- [packages/entities/](../../packages/entities): the manifest, the neutral record types and the entity proxies.
- [packages/backend-system/](../../packages/backend-system): the contract (`shared`), the adapters (`ad4m`, `inmemory`) and the suite (`conformance`). Its [README.md](../../packages/backend-system/README.md) explains the contract layer.
- [packages/app-shell/src/frameworks/solid/stores/](../../packages/app-shell/src/frameworks/solid/stores): the stores.
- [packages/optimism/](../../packages/optimism), [packages/history/](../../packages/history), [packages/clock/](../../packages/clock): framework-neutral state packages that the stores use.

</details>
