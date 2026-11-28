# Module settings

A **module setting** (`ModuleSetting`) is one value a module lets somebody decide, such as whether a call is recorded. The module declares the question and its `levels`. The host draws the controls, stores the answers and gives the module the resolved values through `deps.settings()`.

**Why:** Before module settings, a capability that needed a value put a column on the core `Space` entity, with a setter and a hand-written settings row (the `moduleSettings.ts` header names `autoInterpret` and `extractionTargets`). A setting is a value and resolves by specificity. It is not availability: whether a module runs here is a set of yes-or-no answers that only subtract ([Enablement](../registry/enablement.md)).

**Parent:** [Module contract](README.md)

<details><summary>How it works</summary>

`ModuleSetting` has `key`, `label`, `description`, `type` (`boolean`, `string`, `number`, `enum` with `options`, or `secret`), `default`, `levels` and `resolution`.

| Level (`SETTING_LEVELS`, least specific first) | Who decides | Where the host stores it |
|---|---|---|
| `deployment` | The build | The seed's top-level `settings` |
| `agent` | The agent, in every space | `AgentSettings.moduleSettings` |
| `space` | The community | `Space.moduleSettings` |
| `agent-in-space` | The agent, in this space | `SpacePreference.moduleSettings` |

- `resolution: 'override'` (the default): the most specific level that has a value wins.
- `resolution: 'restrict'`: an AND across every level that has a value and the default. A `false` at any level wins, and a more specific level cannot undo it. A screen shows the row as locked (`lockedBy`). A restrict setting with the default `false` cannot be turned on.
- An absent value is no opinion, not `false`. A stored blob that is not valid JSON also reads as no opinion, with a warning.
- A level that a setting does not list is not consulted, even if an old value is stored there.
- A screen resolves only the levels that bind the people it speaks for (`BINDING`). The space screen reads `deployment` and `space`, so one member's private `false` does not show on the community's control.
- A `secret` is offered at the `agent` level only and shows as a password field. `deps.settings()` leaves secrets out. The store reads one through the `secrets` kernel, which returns only this module's declared secret keys. `lintModule` warns about a secret above the agent level, or a secret without the `secrets` kernel.

`SpaceStore` reads the four levels, calls `moduleRegistry.provideSettings` with `resolveGroup`, and builds the rows for the three settings screens with `settingRows`. Settings of a community-decided module that this space has off are not shown on that space's screens.

</details>

<details><summary>Where in the code</summary>

- [packages/module-system/shared/src/module.ts](../../../packages/module-system/shared/src/module.ts): `ModuleSetting`, `SettingLevel`, `SettingResolution`.
- [packages/app-shell/src/shared/moduleSettings.ts](../../../packages/app-shell/src/shared/moduleSettings.ts): `SETTING_LEVELS`, `BINDING`, `resolveSetting`, `resolveGroup`, `settingRows`, `parseSettings`, `writeSetting`, `clearSetting`.
- [packages/app-shell/src/frameworks/solid/stores/SpaceStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/SpaceStore.tsx): `settingLevels`, `spaceModuleSettings`, `myModuleSettings`, `agentModuleSettings`.
- [packages/app-shell/src/shared/registries/moduleRegistry.ts](../../../packages/app-shell/src/shared/registries/moduleRegistry.ts): `secretKeysOf`, the `secrets` kernel, `settingGroups`, `provideSettings`.
- [packages/module-system/shared/src/lint.ts](../../../packages/module-system/shared/src/lint.ts): the checks on secret settings.

</details>
