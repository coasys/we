# The module system

Feature modules — the developer rung above blocks. A module contributes capabilities a community
can turn on: calls, notes, transcription, polls, the globe, the graph. Which modules a deployment
ships is the seed's `modules` list; which a space enables and which an agent installs layer on top
(`Space.enabledModules`, `AgentSettings.installedModules`).

**Start with [`docs/guides/writing-a-module.md`](../../docs/guides/writing-a-module.md)**, then
`shared/src/module.ts` — the contract — and `shared/src/kernels.ts` — what a store may reach.

## Packages

| Package                 | Role                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `@we/module-shared`     | The contract: `ModuleDefinition` (`manifest`, `contributes`, `createStore`), the kernels, the store markers, `lintModule`                   |
| `@we/module-testing`    | Test a module without a host: `fakeDeps`, `fakeRecords`, `fakeAgentData`, `fakePresence`, `buildStore`                                      |
| `@we/module-notes`      | A per-space scratchpad — **declaration only**, no store; the shape to copy first                                                            |
| `@we/module-pocket`     | Gather things from any space into a panel that is yours — the agent-scoped module                                                           |
| `@we/module-polls`      | Ask the space a question — the module that uses every contribution: entities, a block, a view, parts, a function, a setting, a store        |
| `@we/module-call`       | WebRTC calls: the module built on kernels (`presence`, `ephemeral`, `media`, `peerConnection`)                                              |
| `@we/module-transcribe` | Speech-to-text and extraction over the backend's ports, with two panels and a `restrict` setting                                            |
| `@we/module-graph`      | Placeable graph fragments and the plugin catalogue over `packages/graph-system/`; contributes `GraphView`                                   |
| globe family            | `globe/module` (`@we/module-globe`) · `globe/protocol` · `globe/layers` · `globe/widget` — the Cesium globe as module + layer plugin system |

## The contract in one paragraph

A module definition is three things: a **manifest** (id, name, what it requires — backends,
frameworks, kernels, permissions), **contributions** (entities, parts, panels, slots, anchors,
launchers, settings, activities, blocks, views, functions, components, an embed) and an optional
**`createStore`**, the one piece that is code. The host fans the contributions out to registries it
already has and decides where everything renders; a panel's openness is the host's unless the module
claims it. A store is built with injected reactivity and only the **kernels** its manifest named, and
its members are **private by default** — `deps.state` / `deps.action` publish one, with a sentence,
under `modules.<id>.<member>`. A module never imports the shell; every package exports one
`createModule(host)` and the shell's registry is generated from the seed.

## Working here

- `pnpm create-module <id> "<Name>"` scaffolds one.
- Tests: `pnpm --filter @we/module-<id> test`; the contract's own lint is `lintModule` from
  `@we/module-testing`.
- `pnpm validate:schemas` covers every `.schema.ts` here and knows each module's members, parts and
  entities from the generated context.
- After changing what a module contributes: `pnpm --filter @we/ai-context generate-context`, so the
  reference and the validator learn it.
