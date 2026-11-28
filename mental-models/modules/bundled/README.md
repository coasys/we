# Bundled modules

The bundled modules are the module packages in `packages/module-system/` that WE's own seed builds in: `call`, `transcribe`, `feed`, `live`, `pocket`, `notes`, `globe`, `graph`, `flux` and `polls`. Each package exports `createModule(host)`.

**Why:** Most of their user interface is schema fragments in their contributions, and the store is the only code. So a module can be read as a manifest, its parts and one store (`module.ts` header: "the first two are data, the third is code").

**Parent:** [Modules](../README.md)

## Parts
- [Calls](calls/README.md): the call module, the call record, its WebRTC mesh, backend sessions, and the live module that shares cursors and views in a call.
- [Transcription](transcription/README.md): capture of each agent's own microphone into the call record, and the interpretation passes over it.
- [Feed](feed.md): the space's timeline of posts and calls, and `@we/messages`, which draws one message line.
- [Personal modules](personal.md): notes and Pocket, which are agent-scoped and keep their data in the agent's personal space.
- [Space tools](space-tools/README.md): polls, the globe and Flux.

<details><summary>How it works</summary>

| Module | Scope | Kernels | Surface |
|---|---|---|---|
| `call` | space | records, presence, ephemeral, media, peerConnection, call | chrome |
| `transcribe` | space | records, presence, media, transcription, interpretation | chrome |
| `feed` | space | records, interpretation | chrome |
| `live` | space | presence, ephemeral, view | chrome |
| `notes` | agent | agentData, records | chrome |
| `pocket` | agent | agentData | chrome |
| `polls` | space | records | content |
| `globe` | space | — | capability |
| `graph` | space | — | capability |
| `flux` | space | — (requires the `ad4m` backend) | capability |

The graph module is on the [Graph system](../graph-system/README.md) page, with the engine that it lends to templates.

Calls and transcription meet without naming each other. The call publishes a `call` presence activity with its `record`. Transcription reads that activity and the stream that the call publishes on the `media` kernel, and puts its toggle in the call's `call-controls` anchor.

</details>

<details><summary>Where in the code</summary>

- [packages/module-system/](../../../packages/module-system): one folder per module.
- [packages/module-system/README.md](../../../packages/module-system/README.md): the package list.
- [packages/app-shell/src/shared/registries/bundledModules.generated.ts](../../../packages/app-shell/src/shared/registries/bundledModules.generated.ts): the modules in this build.

</details>
