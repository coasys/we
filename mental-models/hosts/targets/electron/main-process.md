# Main process

The Electron main process owns the app's windows and everything outside the renderer. It serves the renderer over local HTTP, exposes a fixed set of IPC calls to the main window through the preload script, opens the identity window, and keeps the app running in the tray while the window is closed.

**Why:** The renderer is served from `http://localhost:9080` and not from `file://`, so it uses the same protocol as the embedded apps that it frames (`appUrl` in `main.js`). Each IPC handler answers only the main window's top frame on the app's origin (`isFromWindow` in `ipcSender.js`). The app runs the person's executor, which keeps syncing while no window is open, so closing the window hides it when a tray icon can bring it back (`tray.js`).

**Parent:** [Electron](README.md)

<details><summary>How it works</summary>

1. `requestSingleInstanceLock()`: a second launch opens the window of the first one.
2. `app.whenReady`: `startAppServer()` (express on port 9080 with a single-page-app fallback, plus `setupSeedServers()` for the [embedded apps](../../platform/embedded-apps.md)) unless `VITE_DEV_SERVER_URL` is set. Then the [executor process](executor-process.md), `installApplicationMenu`, `installTray` and `createWindow`.
3. `createWindow` sets `contextIsolation` and the preload script. `installContentSecurityPolicy` adds the policy from `seed-csp.json`, which `@we/csp` builds at prebuild time. `navigationPolicy.js` decides which origins the window may open.
4. `preload.js` exposes `window.electron`: `getPort`, `getToken`, accounts, `restartExecutor`, `chooseFile`, `saveFile`, the screen-source calls and `custody {open, publicState}` (not on Windows). Each call that waits for an answer is one IPC channel registered with `handleFromWindow`.
5. A screen share uses the OS picker (`useSystemPicker: true`). Where the OS draws no picker, `askRendererForScreenSource` sends the sources to the renderer (`PlatformAdapter.screenSources`).
6. The Help menu has "Restart in Safe Mode", which loads the app with `?safe`.
7. `identity-open` opens the [identity window](../../identity/identity-window.md) on the `we-identity://` scheme, in its own session partition, and the window shows only its own page.
8. `before-quit` stops the custody sidecar and the executor.

</details>

<details><summary>Where in the code</summary>

- [electron/main.js](../../../../apps/we-electron/electron/main.js): `startAppServer`, `createWindow`, `installContentSecurityPolicy`, `installApplicationMenu`, `openIdentityWindow`, `askRendererForScreenSource`, the IPC handlers.
- [electron/preload.js](../../../../apps/we-electron/electron/preload.js) and [electron/ipcSender.js](../../../../apps/we-electron/electron/ipcSender.js): `isFromWindow`, `handleFromWindow`.
- [electron/navigationPolicy.js](../../../../apps/we-electron/electron/navigationPolicy.js): `trustedOrigins`; [electron/tray.js](../../../../apps/we-electron/electron/tray.js): the tray and hide-on-close.
- [electron/identityWindow.js](../../../../apps/we-electron/electron/identityWindow.js) and [electron/identityPreload.js](../../../../apps/we-electron/electron/identityPreload.js): the identity window's life and bridge.
- [packages/csp/](../../../../packages/csp/): `@we/csp`.

</details>
