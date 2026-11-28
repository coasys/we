# Backend contract

The **backend contract** is the set of ports in `@we/backend-shared` that every backend implements. A connector returns one `BackendPorts` object for a session. Its required ports are `agentSession`, `lifecycle`, `schemas`, `profiles`, `ephemeral` and `dataBindings(deps)`; the other ports are optional, and a backend without a capability leaves its port out.

**Why:** The contract is framework-neutral and backend-neutral TypeScript, so the shell, the renderer and the modules depend on it and not on AD4M. An optional port is feature-detected: a backend that lacks the capability omits the port, and the caller that wanted it says so instead of failing silently. The package also holds the reference query engine and the policy evaluator, so each rule has one implementation that every backend shares.

**Parent:** [Data](../README.md)

## Parts

- [Data source](data-source.md): `DataSource`, `EntityClass`, `LiveQuery` and the renderer's data bindings.
- [Dataset lifecycle](lifecycle.md): `DatasetHandle`, `DatasetRef`, `DatasetLifecyclePort` and `AgentSessionPort`.
- [Schemas](schemas.md): `SchemaPort`, which installs entities into a dataset and reads them back.
- [Query planning](queries.md): the query IR, the compiler, capability planning, `routeQuery` and the reference engine.
- [Ephemeral and presence](ephemeral.md): signals that are not stored, and the presence protocol over them.

<details><summary>How it works</summary>

| Port                                                                                                                       | Required | What it does                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `agentSession`                                                                                                             | yes      | sign up, sign in, the current agent ([Dataset lifecycle](lifecycle.md))                                                                  |
| `lifecycle`                                                                                                                | yes      | list, create, publish, join and remove datasets ([Dataset lifecycle](lifecycle.md))                                                      |
| `schemas`                                                                                                                  | yes      | install and read entities in a dataset ([Schemas](schemas.md))                                                                           |
| `profiles`                                                                                                                 | yes      | `ProfileDirectoryPort`: `get`, `publish`, `uploadFile` for agent profiles                                                                |
| `ephemeral`                                                                                                                | yes      | unstored signals per dataset ([Ephemeral and presence](ephemeral.md))                                                                    |
| `dataBindings`                                                                                                             | yes      | the bindings the schema renderer reads ([Data source](data-source.md))                                                                   |
| `transcription`                                                                                                            | no       | `TranscriptionPort`: lists the transcription models (`TranscriptionRecord`) and opens a stream that takes utterances and returns text    |
| `runtime`, `models`, `languageModel`, `agents`, `interpretation`, `workflows`, `references`, `call`, `identity`, `persons` | no       | runtime administration, AI models, text generation, agents, interpretation, workflows, referrers of a value, calls, identity and persons |

`BackendPortsContext` gives the adapter `selfId` and `afterFirstScreen`. The connector that builds the ports belongs to [Backend connector](../../hosts/platform/backend-connector.md). The space policy format (`policy.ts`) also lives in this package; its owner page is [Policy](../spaces/policy.md).

</details>

<details><summary>Where in the code</summary>

- [packages/backend-system/shared/src/](../../../packages/backend-system/shared/src): the contract.
- [packages/backend-system/shared/src/backendPorts.ts](../../../packages/backend-system/shared/src/backendPorts.ts): `BackendPorts`, `BackendPortsContext`, `SchemaPort`, `ProfileDirectoryPort`, `DataBindingDeps`.
- [packages/backend-system/shared/src/transcription.ts](../../../packages/backend-system/shared/src/transcription.ts): `TranscriptionPort`.
- [packages/backend-system/shared/README.md](../../../packages/backend-system/shared/README.md): the contract overview.
- [packages/backend-system/README.md](../../../packages/backend-system/README.md): why WE has a contract layer.

</details>
