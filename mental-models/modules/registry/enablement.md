# Enablement

Whether a module runs here is four answers that intersect: the deployment registered it, the agent installed it, the space enabled it, and the agent did not mute it in this space. `spaceStore.activeModules` is the result. The module's chrome and the module rail read it.

**Why:** The layers answer different questions and no layer replaces another. The deployment says what exists, the agent says what it wants anywhere, the community says what it runs, and the agent says what it wants here (`activeModules` comment). Availability only subtracts. A value that resolves by specificity is a [module setting](../contract/settings.md), not a layer.

**Parent:** [Module registry](README.md)

<details><summary>How it works</summary>

| Layer | Stored in | When unset |
|---|---|---|
| Registered | `moduleRegistry` (from the seed) | — |
| Installed (agent, everywhere) | `AgentSettings.installedModules` | Every registered module |
| Enabled (community, this space) | `Space.enabledModules` | The seed's modules that do not say `enabled: false` (`defaultEnabledModules`) |
| Muted (agent, this space) | `SpacePreference.mutedModules` | Nothing muted |

`resolveEnabledModules(raw, fallback)` reads a stored list. Unset means "not decided", not "none", and malformed JSON falls back with a warning.

```
activeModules = (enabled ∩ installed − muted)  ∪  (agent-scoped modules that are installed)
```

An **agent-scoped module** (`manifest.scope: 'agent'`, such as notes and Pocket) skips the community layer. It is active wherever the agent is, also outside a space.

- **Chrome gate:** `gateOnSpace` wraps each slot and panel frame in `$if` with the condition `'<id>' in spaceStore.activeModules`. If the module declares `holds`, the condition is `… || modules.<id>.<holds>`, so the call's chrome stays while the agent walks into a space that does not enable calls.
- **Rail:** `spaceStore.moduleLaunchers` has, for each active module, one entry per panel with an `icon` (its label becomes `activeLabel` while open, and `busy` comes from `busyWhen`), then the module's own `launchers`. An entry with `availableWhen` false is left out. The key order of the generated registry, which is the seed's order, is the rail's order.
- **Settings:** `moduleInstallSettings` lists every registered module for the agent layer, with its `capabilitiesOf` list. A `capability` module has no switch. The space settings show only community-decided modules.

</details>

<details><summary>Where in the code</summary>

- [packages/app-shell/src/frameworks/solid/stores/SpaceStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/SpaceStore.tsx): `installedModules`, `enabledModules`, `mutedModulesFor`, `activeModules`, `moduleLaunchers`, `moduleInstallSettings`.
- [packages/app-shell/src/frameworks/solid/stores/space/enabledModules.ts](../../../packages/app-shell/src/frameworks/solid/stores/space/enabledModules.ts): `resolveEnabledModules`, `registeredModules`, `defaultEnabledModules`.
- [packages/app-shell/src/shared/seedModules.ts](../../../packages/app-shell/src/shared/seedModules.ts): `seedModuleIds`, `seedDefaultEnabledModules`.
- [packages/app-shell/src/shared/registries/moduleRegistry.ts](../../../packages/app-shell/src/shared/registries/moduleRegistry.ts): `gateOnSpace`, `isCommunityDecided`, `launchersOf`.
- [docs/architecture/chrome-and-panels.md](../../../docs/architecture/chrome-and-panels.md): the rail and the docks.

</details>
