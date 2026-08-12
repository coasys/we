# The module system

Feature modules — the developer rung above blocks. A module contributes
capabilities a community can turn on: calls, notes, transcription, the globe,
the graph. Which modules a deployment ships is the seed's `modules` list;
which a space enables and which an agent installs layer on top
(`Space.enabledModules`, `AgentSettings.installedModules`).

## Packages

| Package                | Role                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `@we/module-shared`    | The contract (`src/module.ts`) — what a module author implements: store, components, launchers, anchors, models, settings |
| `@we/module-call`      | WebRTC calls: tiles, presence, the call dock                                                     |
| `@we/module-notes`     | Collaborative notes over collection blocks                                                       |
| `@we/module-transcribe`| Speech-to-text over the backend's transcription port                                             |
| `@we/module-graph`     | The graph feature module — placeable fragments + plugin catalog over `packages/graph-system/`    |
| globe family           | `globe/module` (`@we/module-globe`) · `globe/protocol` · `globe/layers` · `globe/widget` — the Cesium globe as module + layer plugin system |

## The contract in one paragraph

A module declares what it contributes and the shell decides where it renders:
components register into the component registry (usable from any template),
stores publish under `modules.<id>.*` (`$store`/`$action` reach them without
the shell knowing the member list), launchers appear in the module rail of
spaces that enable the module, and anchors + `$slot` let one module's chrome
host another's contributions. A module never imports the shell; the shell
never imports a module directly — `bundledModules` wires the set the seed
names. Modules that need a specific backend declare it (`backends: ['ad4m']`);
everything else stays backend-neutral through the ports.

## Working here

Read `shared/src/module.ts` first — the interface is the documentation, and
it is deliberately exhaustive. The globe family's layers package documents the
layer plugin system in `globe/layers/README.md` / `EXAMPLES.md`.

Tests: `pnpm --filter @we/module-call test`, `--filter @we/module-transcribe
test`, `--filter @we/module-shared test`.
