# Space tools

Three modules that a space uses for its content and not for its chrome: polls, which adds a record type and a block; the globe, which lends a component to templates; and Flux, which reads records that the Flux app writes.

**Why:** `moduleSurface` sorts a module by what it contributes. Polls has a view and a block but no panels, so it is `content`. The globe and Flux have no chrome and no content of their own, and only lend a component or a store member, so they are `capability`. Settings → Modules lists a capability module without a switch (`moduleInstallSettings`, `switchable: false`), because to remove it would take a component away from a template that uses it, and nothing would tell the person why.

**Parent:** [Bundled modules](../README.md)

## Parts

- [Polls](polls.md): the contract's smallest complete module, with entities, a block, a view, a part, a function, a setting and a store.
- [Globe](globe.md): the globe family of packages, the `CesiumGlobe` component, and the choice of engine.
- [Flux](flux.md): one AD4M query for the messages in a Flux conversation subgroup.

<details><summary>How it works</summary>

| Module  | Requires                                           | Contributes                                                                        | Store                  |
| ------- | -------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------- |
| `polls` | kernel `records`                                   | entities `Poll`, `Vote`; block; view `pollsView`; parts; function `tally`; setting | `vote`                 |
| `globe` | framework `solid`; network permissions for imagery | component `CesiumGlobe`; five settings                                             | `engine`, `drawsSpace` |
| `flux`  | backend `ad4m`                                     | nothing                                                                            | `subgroupMessages`     |

The graph module is also a capability module. It is on the [Graph system](../../graph-system/README.md) page.

</details>

<details><summary>Where in the code</summary>

- [packages/module-system/polls/](../../../../packages/module-system/polls), [packages/module-system/globe/](../../../../packages/module-system/globe), [packages/module-system/flux/](../../../../packages/module-system/flux): the three packages.
- [packages/app-shell/src/shared/registries/moduleRegistry.ts](../../../../packages/app-shell/src/shared/registries/moduleRegistry.ts): `moduleSurface`.

</details>
