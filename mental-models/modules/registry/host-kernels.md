# Host kernels

`moduleHostServices.ts` is where the app shell implements the kernels. `createModuleStoreDeps` builds one deps object whose kernels forward to host services. The host stores publish those services later, with `provideModuleHostServices`. `HOST_KERNELS` lists the kernels this host implements, and registration compares each manifest against it.

**Why:** Modules register in `PlatformProvider`, above `StoreProvider` ([Providers](../../hosts/boot/providers.md)), because the registry must be full before the stores render. The ports a module wants (transport, presence, the current dataset) live in stores that do not exist yet. So the deps are stable objects whose methods look up the service at call time, and each one gives a safe answer before the service arrives (`moduleHostServices.ts` header).

**Parent:** [Module registry](README.md)

<details><summary>How it works</summary>

| Service slice                                                                                                                                                                                                         | Published by                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `dataset`, `datasetUri`, `datasetRefKey`, `selfId`, `ephemeral`, `call`, `transcription`, `languageModel`, `interpretation`                                                                                           | `DatasetStore`                                |
| `datasetByUri`, `createEntity`, `linkEntity`, `unlinkEntity`, `updateEntity`, `removeEntity`, `findEntities`, `subscribeEntities`, `documents`, `agentData`                                                           | `TemplateProvider`                            |
| `presence`                                                                                                                                                                                                            | `PresenceStore`                               |
| `notify`, `identities`                                                                                                                                                                                                | `ProfileStore`                                |
| `callOnScreen`, `showCallOnScreen`, `showPart`, `datasets`, `ensureBoardFor`, `spaceRoot`                                                                                                                             | `SpaceStore`                                  |
| `interpretationTargets`, `interpretationTargetsLoaded`, `setInterpretationTarget`, `setAutoInterpret`, `interpretCollection`, `watchCollection`, `unwatchCollection`, `reconcileCollection`, `proposalsForCollection` | `SpaceStore`, through `interpretationRuntime` |
| `interpretationAvailable`, `interpretationActivity`, `interpretationProposalsRevision`, `autoInterpretEnabled`                                                                                                        | `InterpretationStore`                         |
| `view`                                                                                                                                                                                                                | `LiveView`                                    |

- `provideModuleHostServices(slice)` merges a slice and returns a function that withdraws only the entries it still owns.
- Each forwarding accessor reads a revision signal (`tracked`), and each provide bumps it. An effect that a store starts before a service exists therefore runs again when the service arrives. Without this, the effect would track nothing and never run again.
- `targeted(target)`: a write that names a dataset goes to that dataset. A write that names none goes to the space on screen. A named dataset that is not joined is refused, not replaced by the space on screen.
- `media`: wraps `navigator.mediaDevices`. `enumerateDevices` returns only inputs, and returns `[]` where it cannot answer. `publish` holds one stream for the whole host. A second publisher replaces the first, and `input()` is a signal of the published stream.
- `call`: `createCallKernel({ port, current, byUri })` over the backend's `CallPort`. `available()` is true when the backend has a port ([Backend sessions](../bundled/calls/sessions.md)).
- `secrets` is built per module in the registry's `depsFor`, not here ([Module settings](../contract/settings.md)).
- `notifyCopiedIn(event)` tells the modules that called `records.onCopiedIn` that a post arrived from another space.

`moduleHostComponents` lends framework components to module factories: `CesiumGlobe` (`GlobeOnDemand`, which loads the Cesium or the MapLibre engine from the globe settings) and `GraphView` (`GraphViewOnDemand`, which loads `GraphHost` on first use). `registerModuleComponents(moduleRegistry.components())` makes the components that modules contribute names that a template can use.

</details>

<details><summary>Where in the code</summary>

- [packages/app-shell/src/shared/registries/moduleHostServices.ts](../../../packages/app-shell/src/shared/registries/moduleHostServices.ts): `ModuleHostServices`, `provideModuleHostServices`, `createModuleStoreDeps`, `HOST_KERNELS`, `targeted`, `tracked`, `notePublisher`.
- [packages/app-shell/src/shared/callKernel.ts](../../../packages/app-shell/src/shared/callKernel.ts): `createCallKernel`.
- [packages/app-shell/src/frameworks/solid/providers/PlatformProvider.tsx](../../../packages/app-shell/src/frameworks/solid/providers/PlatformProvider.tsx): where the deps are made and `initializeIntegrations` runs.
- [packages/app-shell/src/frameworks/solid/registries/moduleComponents.tsx](../../../packages/app-shell/src/frameworks/solid/registries/moduleComponents.tsx): `moduleHostComponents`, `GlobeOnDemand`, `GraphViewOnDemand`.
- [packages/app-shell/src/shared/interpretation/](../../../packages/app-shell/src/shared/interpretation): the host side of the interpretation kernel ([Interpretation](../bundled/transcription/interpretation.md)).

</details>
