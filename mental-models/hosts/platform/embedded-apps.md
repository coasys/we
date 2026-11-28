# Embedded apps

An **embedded app** is a separate AD4M app that the seed lists under `apps` and that WE shows in a `we-iframe`. `initializeIntegrations` turns each entry into a module that contributes one embed. The **app bridge** then gives the frame the executor connection: the port and token on desktop, or a proxy over `postMessage` on web.

**Why:** An embedded app is registered as a module, so the module registry gates, refuses and reports it like any other module. Its manifest requires the `ad4m` backend, so a host without that backend refuses it at registration with a reason (`shared/initializeIntegrations.ts`). The app bridge starts before the first `await` in `SessionStore`, so it receives a frame's request during a slow connect too. The bridge answers only frames from an origin that a registered embed names (`moduleRegistry.embeds()`), so a frame from any other URL gets no connection.

**Parent:** [Platform](README.md)

<details><summary>How it works</summary>

1. For each `seed.apps` entry, `defineModule` builds a manifest (`requires.backends: ['ad4m']`, the app's capabilities as permissions) and an embed whose URL is `platformAdapter.resolveAppUrl(app, isDev)`.
2. In production, a desktop target serves each embedded app on a local port from the seed's port map: Electron with `setupSeedServers`, Tauri with `generated::setup_seed_servers` in release builds. Each target's `scripts/generate-seed-config.cjs` writes the port map and the server code from the seed.
3. `startAppBridge({isDesktop, port, token, serverUrl, agentUnlocked})` listens for messages from the frames.
4. A frame sends `REQUEST_AD4M_CONFIG`. On desktop the bridge answers with the port and token after the agent unlocks. On web it answers `proxy: true`, and the frame then sends `AD4M_PROXY_WS_*` and `AD4M_PROXY_HTTP_*` messages, which the bridge carries out from the host page.

</details>

<details><summary>Where in the code</summary>

- [shared/initializeIntegrations.ts](../../../packages/app-shell/src/shared/initializeIntegrations.ts): the `seed.apps` loop.
- [services/appBridge.ts](../../../packages/app-shell/src/frameworks/solid/services/appBridge.ts): `startAppBridge`, `AppBridgeDeps`, `isCredentialedOrigin`.
- [we-electron/scripts/generate-seed-config.cjs](../../../apps/we-electron/scripts/generate-seed-config.cjs) and [we-tauri/scripts/generate-seed-config.cjs](../../../apps/we-tauri/scripts/generate-seed-config.cjs): port maps and seed servers; [we-tauri/src-tauri/src/app_server.rs](../../../apps/we-tauri/src-tauri/src/app_server.rs): `serve_static_app`.
- The seed and the module contract: [Modules](../../modules/README.md).

</details>
