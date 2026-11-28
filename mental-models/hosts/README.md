# Hosts

A **target** runs WE. It gives the app shell a **platform adapter** (where WE runs) and a **backend connector** (how WE reaches its data), and the app shell then boots the session and renders the live template. On a desktop target, the target also starts an AD4M executor and a **custody service** beside the window. The tools that write and test WE (the AI context, the agent tools, the CLI, the end-to-end tests) also live in this branch.

**Why:** The two contracts vary independently. `resolveAppUrl` changes with the platform, and the connection changes with the data layer, so a target picks one of each (`PlatformAdapter` in `packages/app-shell/src/shared/platform/types.ts`). Each target is thin: everything after "here is the platform and the connector" is in `@we/app-shell` once.

**Parent:** [WE](../README.md)

## Parts
- [Boot](boot/README.md): how the app shell starts: providers, the session's boot states, the first screen, new builds.
- [Platform](platform/README.md): the platform adapter, the backend connector, local accounts and embedded apps.
- [Targets](targets/README.md): web, Electron, Tauri, and the hosts for development and tests.
- [Identity](identity/README.md): the person's identity on the WE side: master-key custody, the identity window, devices.
- [AI](ai/README.md): the generated AI context, the agent tools, and the model calls in the app.

<details><summary>How it works</summary>

```
 target (apps/we-web │ we-electron │ we-tauri │ we-preview)
   │  render(<PlatformProvider seed platform backend><App/></PlatformProvider>)
   ▼
 PlatformProvider ── initializeIntegrations(seed): slots, embedded apps, feature modules
   ▼
 App ── ErrorBoundary ─► StoreProvider ─► TemplateProvider (renders the live template)
   │                         │
   │                         └─ SessionStore.initialise ─► backend.initialize(ctx)
   │                                                        │
   ▼                                                        ▼
 boot screen (core:bootScreen) ◄── boot state ──  AD4M executor: ad4m-connect (web)
                                                  or a local executor (desktop)
```

1. The target renders `PlatformProvider` with the seed, its platform adapter and its backend connector ([Platform](platform/README.md)).
2. `App` mounts the stores. `SessionStore` calls the connector once, and the boot state picks the boot screen's step ([Boot](boot/README.md)).
3. After the session unlocks, `BootController` loads the datasets and opens the first space.

</details>

<details><summary>Where in the code</summary>

- [packages/app-shell/src/frameworks/solid/](../../packages/app-shell/src/frameworks/solid/): `App`, the providers, the stores, the app bridge.
- [packages/app-shell/src/shared/platform/](../../packages/app-shell/src/shared/platform/) and [shared/backend/](../../packages/app-shell/src/shared/backend/): the two contracts a target fills.
- [apps/](../../apps/): the targets and the playgrounds.
- [crates/custody/](../../crates/custody/) and [packages/identity-window/](../../packages/identity-window/): desktop master-key custody and its window.
- [packages/ai-context/](../../packages/ai-context/), [packages/agent-tools/](../../packages/agent-tools/), [packages/cli/](../../packages/cli/), [packages/e2e/](../../packages/e2e/): the tools.
- Depth: [codebase-map.md](../../docs/architecture/codebase-map.md), [package-conventions.md](../../docs/architecture/package-conventions.md), [meta-app-vs-separate-apps.md](../../docs/architecture/meta-app-vs-separate-apps.md).

</details>
