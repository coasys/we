# Dataset lifecycle

A **dataset** is the neutral name for one queryable data container; on AD4M it is a perspective. `DatasetLifecyclePort` manages which datasets exist: list, get, create, remove, publish, join and subscribe. `AgentSessionPort` says whether the agent's session is usable: `status`, `signUp`, `signIn`, `signOut` and `me`.

**Why:** Boot, dataset switching, and space create and join are expressible against these two ports. So the in-memory backend runs the same flows in tests with no executor. A `DatasetRef` pairs the metadata that the shell reads (id, name, shared address) with the opaque handle that queries use, so neither side has to reconstruct the other.

**Parent:** [Backend contract](README.md)

<details><summary>How it works</summary>

| `DatasetRef` field | Meaning                                                                   |
| ------------------ | ------------------------------------------------------------------------- |
| `id`               | the backend-local id; it has no meaning on another agent's machine        |
| `name`             | the dataset name                                                          |
| `sharedUri`        | the global address with its scheme, once published or joined              |
| `sharedId`         | the global id without a scheme; shared records store and compare this one |
| `handle`           | the opaque `DatasetHandle` ([Data source](data-source.md))                |

| `DatasetLifecyclePort` member                  | What it does                                                  |
| ---------------------------------------------- | ------------------------------------------------------------- |
| `list({ fresh })`, `get(id)`                   | read the datasets; `fresh` asks the backend again             |
| `create(name)`, `remove(id)`                   | make or delete a local dataset                                |
| `publish?(id, { sharing, server })`            | share a local dataset; returns `uri` and `sharedId`           |
| `join?(idOrUri)`                               | join a shared dataset; accepts a full URI or a bare shared id |
| `whenSynced?(id)`                              | resolves when a joined dataset holds the shared data          |
| `members?(id)`                                 | the other agents that hold a shared dataset                   |
| `sharingOptions?()`                            | the ways `publish` can sync: `peer-to-peer` or `server`       |
| `subscribe({ onAdded, onUpdated, onRemoved })` | change events; returns an unsubscribe function                |

A backend with no sharing concept omits `publish` and `join`. `parseServerUrl` refuses a server that is not an http(s) address. What WE does with these calls is on [Spaces](../spaces/README.md).

</details>

<details><summary>Where in the code</summary>

- [packages/backend-system/shared/src/lifecycle.ts](../../../packages/backend-system/shared/src/lifecycle.ts): `DatasetRef`, `DatasetChangeHandlers`, `SharingOption`, `DatasetLifecyclePort`, `AgentSessionPort`, `SessionTimeoutError`, `parseServerUrl`.
- [packages/backend-system/ad4m/src/lifecycleAdapter.ts](../../../packages/backend-system/ad4m/src/lifecycleAdapter.ts): `createAd4mDatasetLifecycle`, `createAd4mAgentSession`.
- [packages/backend-system/inmemory/src/lifecycle.ts](../../../packages/backend-system/inmemory/src/lifecycle.ts): `createInMemoryLifecycle`, `createInMemoryAgentSession`.

</details>
