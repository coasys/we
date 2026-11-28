# Platform

A target fills two contracts. The **platform adapter** (`PlatformAdapter`) says where WE runs and what the host can do there. The **backend connector** (`BackendConnector`) says how WE reaches its data. The platform adapter has four optional parts: `accounts`, `executor`, `saveFile` and `screenSources`. The web target omits all four, and the screens that use them detect this and show nothing.

**Why:** The two contracts were one interface until they varied independently. `resolveAppUrl` changes per platform, the connection changes per data layer, and a target picks each without the other. With one interface, every host that read `isDesktop` also named the data layer (`PlatformAdapter` in `shared/platform/types.ts`). Electron and Tauri differ only in how a call crosses the process boundary, so `createDesktopPlatform` holds the rest once.

**Parent:** [Hosts](../README.md)

## Parts
- [Backend connector](backend-connector.md): the one call that connects: ad4m-connect on web, a local executor on desktop, a guest link.
- [Accounts](accounts.md): local accounts as data directories, and switching between them.
- [Embedded apps](embedded-apps.md): seed apps in a `we-iframe`, and the app bridge that gives them the executor.

<details><summary>How it works</summary>

| `PlatformAdapter` member | Web | Electron, Tauri |
|---|---|---|
| `platform`, `isDesktop` | `'web'`, `false` | `'electron'` or `'tauri'`, `true` |
| `resolveAppUrl(app, isDev)` | the dev server, else `webUrl` or `dist` | the dev server, else `http://localhost:<portMap[app.id]>` |
| `accounts: AccountHost` | absent | list, create, select, remove, `applySelection` |
| `executor: ExecutorHost` | absent | `restart`, `chooseFile`; `getSettings`/`setSettings` on Tauri only |
| `saveFile` | absent (the browser's save picker or a download) | the host's save dialog (Electron) |
| `screenSources` | absent (the browser's picker) | a source list where the OS draws no picker (Electron) |

`ExecutorHost` holds the arguments of a process that has not started yet, so a change ends with `restart()`. On Electron the settings live in the executor's own config file, and the settings page reaches them through `RuntimeAdminPort.executorConfig`.

</details>

<details><summary>Where in the code</summary>

- [shared/platform/types.ts](../../../packages/app-shell/src/shared/platform/types.ts): `PlatformAdapter`, `AppConfig`, `AccountHost`, `ExecutorHost`, `ExecutorSettings`, `ScreenSourceHost`.
- [shared/platform/desktop.ts](../../../packages/app-shell/src/shared/platform/desktop.ts): `createDesktopPlatform`.
- [shared/backend/types.ts](../../../packages/app-shell/src/shared/backend/types.ts): `BackendConnector`, `BackendInitResult`.
- The adapters: [webPlatform.ts](../../../apps/we-web/src/platform/webPlatform.ts), [electronPlatform.ts](../../../apps/we-electron/src/platform/electronPlatform.ts), [tauriPlatform.ts](../../../apps/we-tauri/src/platform/tauriPlatform.ts), [previewPlatform.ts](../../../apps/we-preview/src/platform/previewPlatform.ts).

</details>
