# Kernels

A **kernel** is a host capability that a module asks for by name in `manifest.requires.kernels`. The store receives exactly the named kernels in `deps.kernels`. The registry refuses a module that names a kernel the host does not implement.

**Why:** A kernel name is a statement about what a module can reach, so the capability list in Settings → Modules shows it (`kernel:<name>`). Every kernel is a neutral type, not a host store or a backend class, so a module that uses one runs on any host that implements it. The option that lost is one `ModuleStoreDeps` field for each module need: such a bag describes the modules that use it, not a contract. With kernels, a new capability is one more kernel in `kernels.ts` (`kernels.ts` header).

**Parent:** [Module contract](README.md)

<details><summary>How it works</summary>

`KERNEL_NAMES` lists 13 kernels:

| Kernel           | Type                   | What it gives                                                                                                                                                                                                                                                                                                                    |
| ---------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `records`        | `RecordsKernel`        | `create`, `link`, `unlink`, `update`, `remove`, `find`, `subscribe` on the space's records, with `RecordQuery` (`within`, `where`, `order`, `limit`, `offset`, `include`, `select`). `onCopiedIn` reports a record copied into the space. `documents` (`DocumentAccess`) creates, reads, updates and removes composed documents. |
| `agentData`      | `AgentDataKernel`      | `ready`, `refKey`, `create`, `find`, `update`, `remove` and `documents`, on the agent's personal space only.                                                                                                                                                                                                                     |
| `presence`       | `PresenceKernel`       | `peers()`, `setActivity`, `clearActivity`.                                                                                                                                                                                                                                                                                       |
| `ephemeral`      | `EphemeralPort`        | The backend's ephemeral port: channels for signals that are not stored.                                                                                                                                                                                                                                                          |
| `view`           | `ViewKernel`           | `onPointer`, `frame`, `apply`, `decorate`: where this agent is looking, and drawing at a `LiveAnchor` on someone's screen.                                                                                                                                                                                                       |
| `media`          | `MediaKernel`          | `getUserMedia`, `getDisplayMedia`, `enumerateDevices`, `onDevicesChanged`; `publish(stream)` and `input()` share one captured stream between modules.                                                                                                                                                                            |
| `peerConnection` | `PeerConnectionKernel` | `create(configuration)` returns an `RTCPeerConnection`.                                                                                                                                                                                                                                                                          |
| `call`           | `CallKernel`           | A call session that the backend runs ([Backend sessions](../bundled/calls/sessions.md)).                                                                                                                                                                                                                                         |
| `transcription`  | `TranscriptionKernel`  | The backend's `TranscriptionPort` plus `available()`.                                                                                                                                                                                                                                                                            |
| `languageModel`  | `LanguageModelKernel`  | `available()` and `prompt(system, input)`.                                                                                                                                                                                                                                                                                       |
| `interpretation` | `InterpretationKernel` | Extraction passes over a collection, and their proposals ([Interpretation](../bundled/transcription/interpretation.md)).                                                                                                                                                                                                         |
| `secrets`        | `SecretsKernel`        | `get(key)` for this module's `secret` settings.                                                                                                                                                                                                                                                                                  |
| `clocks`         | `ClocksKernel`         | `clock(id)`: a named clock from `@we/clock`, shared with `clockStore` and the globe.                                                                                                                                                                                                                                             |

The host implements the kernels in [Host kernels](../registry/host-kernels.md). A test passes fakes ([Module testing](testing.md)).

</details>

<details><summary>Where in the code</summary>

- [packages/module-system/shared/src/kernels.ts](../../../packages/module-system/shared/src/kernels.ts): `ModuleKernels`, `KERNEL_NAMES`, every kernel interface.
- [packages/module-system/shared/src/call.ts](../../../packages/module-system/shared/src/call.ts): `CallKernel`, `CallSession`.
- [packages/module-system/shared/src/interpretation.ts](../../../packages/module-system/shared/src/interpretation.ts): `InterpretationKernel`.
- [docs/guides/writing-a-module.md](../../../docs/guides/writing-a-module.md): the "Kernels" section.

</details>
