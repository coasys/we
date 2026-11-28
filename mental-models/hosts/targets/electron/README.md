# Electron

The Electron target (`@we/app-electron`) runs WE in a desktop window. Its main process starts an AD4M executor as a child process, starts the `we-custody` sidecar beside it, serves the renderer over local HTTP, and answers the window's IPC calls. The renderer is the same app shell as on web, with `electronPlatform` and a local-executor connector.

**Why:** The executor is a child process, so the main process can restart it without closing the window. A restart reloads the renderer against the new executor (`restartExecutorAndReload` in `main.js`). The renderer gets the executor's port and admin token only over IPC, and each IPC handler answers only the main window's top frame on the app's origin (`ipcSender.js`).

**Parent:** [Targets](../README.md)

## Parts

- [Executor process](executor-process.md): data path, config, spawn arguments, readiness, exit codes and restarts.
- [Main process](main-process.md): the window, the preload and IPC, the app server, the menu, the tray and the identity window.

<details><summary>How it works</summary>

```
main.js (main process)
 ├─ accounts registry ─► data path ─► executor child (executorProcess.js)
 │                                     └─ GET /health ─► we-custody sidecar (custodySidecar.js)
 ├─ express on :9080 (renderer) + seed servers (embedded apps)
 ├─ BrowserWindow ─ preload.js ─ window.electron ─► IPC handlers (ipcSender.js)
 └─ identity window (we-identity:// scheme, own partition) ─► custody sidecar
renderer: src/index.tsx ─ electronPlatform + createLocalAd4mConnector(getPort, getToken)
```

</details>

<details><summary>Where in the code</summary>

- [electron/](../../../../apps/we-electron/electron/): the main process; [electron/main.js](../../../../apps/we-electron/electron/main.js) is its entry.
- [src/index.tsx](../../../../apps/we-electron/src/index.tsx) and [src/platform/](../../../../apps/we-electron/src/platform/): the renderer entry, `electronPlatform`, the connector and the `window.electron` types.
- [identity/main.ts](../../../../apps/we-electron/identity/main.ts): the identity window's renderer.
- [scripts/](../../../../apps/we-electron/scripts/): `generate-seed-config.cjs`, `build-custody.mjs`, `ensure-electron.cjs`; [electron-builder.config.js](../../../../apps/we-electron/electron-builder.config.js): packaging.
- Depth: [DEVELOPMENT.md](../../../../apps/we-electron/DEVELOPMENT.md).

</details>
