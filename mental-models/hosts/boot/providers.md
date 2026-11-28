# Providers

`PlatformProvider` is the outermost component that a target renders. It takes the seed, the platform adapter and the backend connector, registers what the seed names, and gives the platform and the connector to every component below it. `App` then mounts `StoreProvider`, which nests the stores in a fixed order, and `TemplateProvider` inside them.

**Why:** `PlatformProvider` reads its three props once (`untrack`). A target cannot change them after the first render, so every store reads one platform and one connector for the life of the page. The store order is a dependency order: each store reads only the stores above it. `AccountStore` sits above `SessionStore` because the account list is a list of directories, and the boot screen reads it before an executor is connected.

**Parent:** [Boot](README.md)

<details><summary>How it works</summary>

1. `PlatformProvider` calls `initializeIntegrations(platform, seed, …)`, in this order: `installConsoleTrace`, `provideSeed`, `registerCoreSlots`, `validateSeedForLauncher`, the seed's boot screen (`seed.host.ui.bootScreen` replaces the `core:bootScreen` slot), the [embedded apps](../platform/embedded-apps.md), then `activateSeedModules`.
2. It registers the module components (`registerModuleComponents`) and gives `platform.saveFile` to `provideFileSaver`.
3. It provides `PlatformContext` and `BackendContext`. `usePlatform()` and `useBackend()` read them.
4. `App` renders `ErrorBoundary` (fallback `AppFailure`) > `StoreProvider` > `TemplateProvider`, `LiveViewHost`, `ToastContainer`.
5. `StoreProvider` nests: Route, Clock, Shell, Chat, Account, Session, Runtime, Identity, Device, Dataset, Shape, Record, Profile, Theme, Template, Editor, App, Space. Inside Space: `BootController`, then Presence, Interpretation, Workflow, Bundle and `EditorHostAdapter`.

</details>

<details><summary>Where in the code</summary>

- [providers/PlatformProvider.tsx](../../../packages/app-shell/src/frameworks/solid/providers/PlatformProvider.tsx): `PlatformProvider`, `usePlatform`, `useBackend`.
- [shared/initializeIntegrations.ts](../../../packages/app-shell/src/shared/initializeIntegrations.ts): `initializeIntegrations`.
- [shared/registries/slotRegistry.ts](../../../packages/app-shell/src/shared/registries/slotRegistry.ts): `registerCoreSlots` (`core:bootScreen`, `core:consentPrompt` and the other host slots).
- [providers/StoreProvider.tsx](../../../packages/app-shell/src/frameworks/solid/providers/StoreProvider.tsx): the store order.
- [App.tsx](../../../packages/app-shell/src/frameworks/solid/App.tsx): `App`, `AppFailure`.
- The module registry and seed activation: [Modules](../../modules/README.md).

</details>
