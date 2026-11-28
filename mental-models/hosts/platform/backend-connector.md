# Backend connector

A **backend connector** is the object that a target gives to `PlatformProvider` to reach its data. It has one method, `initialize(ctx)`. `SessionStore` calls it once at boot. It does the whole connection sequence and returns the client, the backend ports, and optional facts about the connection. Four connectors exist: ad4m-connect (web), a local executor (Electron and Tauri), a **guest link** (web), and in-memory (preview).

**Why:** The app shell's source imports no `@coasys/*` module. The connector is the one place where a target names its data layer, and everything after it goes through the backend ports. The two desktop targets had the same connection code. Only the transport ("give me the port and token") is per platform, so `createLocalAd4mConnector` takes it as a function and holds the rest (`localExecutor.ts`).

**Parent:** [Platform](README.md)

<details><summary>How it works</summary>

| Connector | Target | What `initialize` does |
|---|---|---|
| `ad4mConnector` | web | `getAd4mConnect(...)` with `hosting: true`, awaits the client, reads `capabilitiesFromToken(core.token)`, builds ports with `createAd4mBackendPorts`; returns `host`, `account`, `disconnect` and `connection {port, token, url}` |
| `createLocalAd4mConnector(getConnection, …)` | Electron, Tauri | gets `{port, token}` from the host, waits `startupDelayMs` (1000 ms), polls `agent.status()` (30 × 500 ms), builds ports with the host's custody service; returns `connection {port, token}` |
| `createGuestConnector(hostUrl)` | web, on a guest link | `connectAsGuest(hostUrl)`; returns `guest: true` |
| `inMemoryConnector` | preview | `createInMemoryBackendPorts` with an unlocked agent `did:preview:me` |

On web, `index.tsx` picks the guest connector only for a guest link (`/join/<spaceId>?host=<url>`, read by `parseGuestLink`) and only when no stored ad4m-connect session exists (`hasStoredSession`). The web connector administers the executor only when ad4m-connect connects to no remote host and the executor is not multi-user.

</details>

<details><summary>Where in the code</summary>

- [shared/backend/types.ts](../../../packages/app-shell/src/shared/backend/types.ts): `BackendConnector`, `BackendInitResult`, `BackendConnectionDetails`, `BackendHostInfo`, `BackendAccountInfo`.
- [we-web/src/platform/ad4mConnector.ts](../../../apps/we-web/src/platform/ad4mConnector.ts), [guestConnector.ts](../../../apps/we-web/src/platform/guestConnector.ts), [storedSession.ts](../../../apps/we-web/src/platform/storedSession.ts): `storedGuestHost`, `hasStoredSession`.
- [shared/guestLink.ts](../../../packages/app-shell/src/shared/guestLink.ts): `parseGuestLink`.
- [backend-system/ad4m/src/localExecutor.ts](../../../packages/backend-system/ad4m/src/localExecutor.ts): `createLocalAd4mConnector`, `connectToLocalExecutor`.
- [we-electron/src/platform/ad4mConnector.ts](../../../apps/we-electron/src/platform/ad4mConnector.ts) and [we-tauri/src/platform/ad4mConnector.ts](../../../apps/we-tauri/src/platform/ad4mConnector.ts): the two transports.
- [we-preview/src/platform/inMemoryConnector.ts](../../../apps/we-preview/src/platform/inMemoryConnector.ts).
- The backend ports and adapters: [Data](../../data/README.md).

</details>
