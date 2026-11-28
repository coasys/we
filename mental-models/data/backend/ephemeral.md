# Ephemeral and presence

The **ephemeral port** carries transient agent-to-agent state that is lossy, last-write-wins and gone on reload: presence, WebRTC signalling, cursors. `EphemeralPort` maps a dataset to an `EphemeralScope`, and each protocol takes a named `channel(tag)` in that scope. **Presence** is the first protocol on it: `createHeartbeatPresence` publishes this agent's state on a timer and derives the list of peers.

**Why:** The rule for this port is: if it must still be there after a refresh, it is not ephemeral. Ephemeral state has no manifest entity, no stable id and no persistence, so it does not go through the query IR. Durable messages go through the data source. The payload is opaque, so one transport carries every protocol, and a feature module gets a tag namespace of its own.

**Parent:** [Backend contract](README.md)

<details><summary>How it works</summary>

1. A consumer calls `ephemeral(dataset)` and gets an `EphemeralScope` (or `null`), then `scope.channel(tag, options)`.
2. An `EphemeralChannel` has `publish(payload, to?)`, `onMessage(cb)` and the optional `onPublishResult(cb)`.
3. Each adapter declares `EphemeralCapabilities`. `planEphemeral(requirements, capabilities)` refuses a consumer that needs more than the backend offers.
4. Presence publishes a `PresenceState`: one `focus` (where the agent is), a list of `activities` (what it is in, for example a call), and a declared `availability` (`available`, `busy`, `away`, `invisible`).
5. `derivePeers` measures each peer's `liveness` (`online`, `idle`, `stale`, `offline`) from the age of its `updatedAt` (`DEFAULT_THRESHOLDS`); liveness is never transmitted. The heartbeat is `DEFAULT_HEARTBEAT_INTERVAL` (5 s). A state change publishes at once. A joiner sets `hello`, and peers re-announce at once.
6. Presence carries only the `agentId`. The UI resolves the profile through `$identities`.

`createInMemoryEphemeralPort` over an `InMemoryBus` is the in-memory transport. `createAd4mEphemeralPort` is the AD4M one.

</details>

<details><summary>Where in the code</summary>

- [packages/backend-system/shared/src/ephemeral.ts](../../../packages/backend-system/shared/src/ephemeral.ts): `EphemeralPort`, `EphemeralScope`, `EphemeralChannel`, `EphemeralCapabilities`, `planEphemeral`, `createInMemoryEphemeralPort`, `InMemoryBus`.
- [packages/backend-system/shared/src/presence.ts](../../../packages/backend-system/shared/src/presence.ts): `PresenceState`, `Focus`, `Activity`, `Availability`, `Liveness`, `Peer`, `derivePeers`, `createHeartbeatPresence`, `PresenceSource`.
- [packages/backend-system/ad4m/src/ad4mEphemeralAdapter.ts](../../../packages/backend-system/ad4m/src/ad4mEphemeralAdapter.ts): `createAd4mEphemeralPort`, `ad4mEphemeralCapabilities`.
- [packages/app-shell/src/frameworks/solid/stores/PresenceStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/PresenceStore.tsx): the Solid binding over presence.

</details>
