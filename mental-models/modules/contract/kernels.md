# Kernels

A **kernel** is a host capability that a module asks for by name in `manifest.requires.kernels`. The store receives exactly the named kernels in `deps.kernels`. The registry refuses a module that names a kernel the host does not implement.

**Why:** Each kernel is bound to the space the module runs in, so a module cannot pass the wrong dataset handle. A kernel name is also a statement about what a module can reach, so the capability list in Settings → Modules shows it (`kernel:<name>`). The `kernels.ts` header records the option that lost: a `ModuleStoreDeps` bag that grew one field per module need until it described two modules instead of a contract.

**Parent:** [Module contract](README.md)

<details><summary>How it works</summary>

`KERNEL_NAMES` lists 13 kernels:

| Kernel | Type | What it gives |
|---|---|---|
| `records` | `RecordsKernel` | `create`, `link`, `unlink`, `update`, `remove`, `find`, `subscribe` on the space's records, with `RecordQuery` (`within`, `where`, `order`, `limit`, `offset`, `include`, `select`). `onCopiedIn` reports a record copied into the space. `documents` (`DocumentAccess`) creates, reads, updates and removes composed documents. |
| `agentData` | `AgentDataKernel` | The same record operations and `documents`, on the agent's personal space only. |
| `presence` | `PresenceKernel` | `peers()`, `setActivity`, `clearActivity`. |
| `ephemeral` | `EphemeralPort` | The backend's ephemeral port: channels for signals that are not stored. |
| `view` | `ViewKernel` | `onPointer`, `frame`, `apply`, `decorate`: where this agent is looking, and drawing at a `LiveAnchor` on someone's screen. |
| `media` | `MediaKernel` | `getUserMedia`, `getDisplayMedia`, `enumerateDevices`, `onDevicesChanged`; `publish(stream)` and `input()` share one captured stream between modules. |
| `peerConnection` | `PeerConnectionKernel` | `create(configuration)` returns an `RTCPeerConnection`. |
| `call` | `CallKernel` | A call session that the backend runs ([Backend sessions](../bundled/calls/sessions.md)). |
| `transcription` | `TranscriptionKernel` | The backend's `TranscriptionPort` plus `available()`. |
| `languageModel` | `LanguageModelKernel` | `available()` and `prompt(system, input)`. |
| `interpretation` | `InterpretationKernel` | Extraction passes over a collection, and their proposals ([Interpretation](../bundled/transcription/interpretation.md)). |
| `secrets` | `SecretsKernel` | `get(key)` for this module's `secret` settings. |
| `clocks` | `ClocksKernel` | `clock(id)`: a named clock from `@we/clock`, shared with `clockStore` and the globe. |

The host implements the kernels in [Host kernels](../registry/host-kernels.md). A test passes fakes ([Module testing](testing.md)).

</details>

<details><summary>Where in the code</summary>

- [packages/module-system/shared/src/kernels.ts](../../../packages/module-system/shared/src/kernels.ts): `ModuleKernels`, `KERNEL_NAMES`, every kernel interface.
- [packages/module-system/shared/src/call.ts](../../../packages/module-system/shared/src/call.ts): `CallKernel`, `CallSession`.
- [packages/module-system/shared/src/interpretation.ts](../../../packages/module-system/shared/src/interpretation.ts): `InterpretationKernel`.
- [docs/guides/writing-a-module.md](../../../docs/guides/writing-a-module.md): the "Kernels" section.

</details>
