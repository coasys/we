# Session store

`SessionStore` holds the connection to the backend and the authenticated identity: the client, the `BackendPorts` object, `agentSession`, `lifecycle`, `ephemeralPort` and `me`. Every store below it reads the ports from here. Its actions sign the agent in (`login`, `unlock`), make the agent (`createAgent`) and sign it out (`logout`).

**Why:** The session depends only on the [backend connector](../../hosts/platform/backend-connector.md) that the host supplies, and everything else depends on the session. The store knows when the session becomes usable, but not what the app loads into it: that load spans several stores, so the boot controller injects it through `onSessionUnlocked`.

**Parent:** [Stores](README.md)

<details><summary>How it works</summary>

1. The store keeps the `ports` of the connector's `BackendInitResult` in `backendPorts`, and exposes `agentSession` and `lifecycle` from it. Both are `null` until the backend connects.
2. `ephemeralPort(dataset)` is `backendPorts()?.ephemeral(dataset)`, so a reader gets `null` before the ports exist.
3. `login(password)` calls `agentSession.signIn`, and `createAgent(password)` calls `agentSession.signUp`. Both then run the post-unlock load that `onSessionUnlocked` registered.
4. `refreshMe` reads `agentSession.me()` into `me`.

The boot state, the boot flow and the sign-in step belong to [Session](../../hosts/boot/session.md).

</details>

<details><summary>Where in the code</summary>

- [packages/app-shell/src/frameworks/solid/stores/SessionStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/SessionStore.tsx): `SessionStore`, `onSessionUnlocked`.
- [packages/app-shell/src/shared/backend/types.ts](../../../packages/app-shell/src/shared/backend/types.ts): `BackendConnector`, `BackendInitResult`.
- [packages/backend-system/shared/src/lifecycle.ts](../../../packages/backend-system/shared/src/lifecycle.ts): `AgentSessionPort` (`status`, `signUp`, `signIn`, `signOut`, `me`).

</details>
