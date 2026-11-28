# Session

`SessionStore` holds the connection to the backend and the authenticated identity: the client, the `BackendPorts` bundle, the boot state and `me`. Every store below it reads the ports from here.

**Why:** The session depends only on the backend connector that the host supplies, and everything else depends on the session. The store knows when the session becomes usable, but not what the app loads into it: that load spans several stores, so the boot controller injects it through `onSessionUnlocked`.

**Parent:** [Stores](README.md)

<details><summary>How it works</summary>

1. On start, the store calls the host's `BackendConnector.initialize(ctx)`. The context gives `selfId` (this agent's DID, read later) and `afterFirstScreen`.
2. `initialize` returns a `BackendInitResult`: `client`, `ports`, and optional `connection`, `host`, `account` and `guest`. The store keeps `ports` in `backendPorts`, and also exposes `agentSession` and `lifecycle` from it.
3. The store asks `agentSession.status()`. With no agent, `bootState` becomes `createAgent`. With a locked agent, it becomes `login`. With an unlocked agent, the post-unlock load runs.
4. `login(password)` calls `signIn`, and `createAgent(password)` calls `signUp`. Both then run the post-unlock load.
5. A failure to initialise sets `bootError` and `bootState` `error`.
6. `ephemeralPort` is `backendPorts()?.ephemeral(dataset)`, so a reader gets `null` before the ports exist.

`BootState` is `initialising`, `login`, `createAgent`, `finishing`, `ready` or `error`. What the boot controller loads, the sign-in screens and identity custody belong to [Hosts](../../hosts/README.md).

</details>

<details><summary>Where in the code</summary>

- [packages/app-shell/src/frameworks/solid/stores/SessionStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/SessionStore.tsx): `SessionStore`, `BootState`, `onSessionUnlocked`.
- [packages/app-shell/src/shared/backend/types.ts](../../../packages/app-shell/src/shared/backend/types.ts): `BackendConnector`, `BackendInitResult`.
- [packages/backend-system/shared/src/lifecycle.ts](../../../packages/backend-system/shared/src/lifecycle.ts): `AgentSessionPort` (`status`, `signUp`, `signIn`, `signOut`, `me`).

</details>
