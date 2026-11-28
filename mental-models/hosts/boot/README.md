# Boot

Boot takes the app shell from a blank page to a signed-in session with its first space open. `PlatformProvider` registers what the seed names, `App` mounts the stores in a fixed order, `SessionStore` connects through the backend connector and sets the **boot state**, and `BootController` loads the person's data after the session unlocks.

**Why:** All targets boot through the same `App`, so the error boundary, the stores and the boot order exist in one place and not once per target (the comment on `App` in `App.tsx`). The connection is one call, `BackendConnector.initialize`, so the app shell does not know which data layer it boots against.

**Parent:** [Hosts](../README.md)

## Parts

- [Providers](providers.md): `PlatformProvider`, `initializeIntegrations`, `App` and the store order.
- [Session start](session.md): the boot states, the sign-in steps and `BootController`.
- [First screen](first-screen.md): the moment the first page is drawn, and the work that waits for it.
- [Build freshness](build-freshness.md): how a tab finds out that a newer build is deployed.

<details><summary>How it works</summary>

```
PlatformProvider ─ initializeIntegrations(platform, seed)        (sync, before render)
App ─ ErrorBoundary ─ StoreProvider ─ TemplateProvider, LiveViewHost, ToastContainer
          │
          ├─ SessionStore.initialise ── firstScreen.hold()
          │      backend.initialize(ctx) ─► session.status()
          │      no agent ─► 'createAgent' │ locked ─► 'login' │ unlocked ─► load
          │
          └─ BootController (on unlock)
                 refreshMe ─► readDatasets ─► prepareSpaceAt ─► system datasets + opening space
                 ─► loadDatasets ─► subscribeToChanges ─► markReady ─► navigate
```

`TemplateProvider` renders the app, shell and route schemas and the host safety prompts. The renderer and the templates are in [Interface](../../interface/README.md). The credential field, the safety prompts and safe mode are [protected pieces](../../interface/chrome/protected-pieces.md).

</details>

<details><summary>Where in the code</summary>

- [App.tsx](../../../packages/app-shell/src/frameworks/solid/App.tsx): `App`, `installStaleBuildReload`, `watchForNewBuild`.
- [providers/](../../../packages/app-shell/src/frameworks/solid/providers/): `PlatformProvider`, `StoreProvider`, `BootController`, `TemplateProvider`.
- [index.ts](../../../packages/app-shell/src/frameworks/solid/index.ts): what a target imports from `@we/app-shell`, and the design-system styles it loads.
- [stores/SessionStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/SessionStore.tsx): `BootState`, `initialise`.
- The stores themselves: [Stores](../../data/stores/README.md).

</details>
