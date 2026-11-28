# Mesh

When the backend runs no call session, the call module connects the peers itself. `createCallMesh` keeps one `RTCPeerConnection` for each other participant, and sends the WebRTC handshake on the space's ephemeral channel `rtc`. `createMediaController` holds this agent's microphone, camera and screen.

**Why:** A mesh needs no server. An SFU is a server, and a local-first app that requires one is not local-first (`mesh.ts` header). The cost is that each peer sends its video to every other peer, which the header gives as a limit of about four to six participants. Media is separate from the mesh because media fails locally and signalling fails between peers. When the two were together, one peer's refused camera prompt could stop everyone's audio (`media.ts` header).

**Parent:** [Calls](README.md)

<details><summary>How it works</summary>

**Membership comes from presence.** The protocol has no join, leave or roster message. `CallMesh.setRoster` gets the peers that presence shows in the call. A new peer gets a connection, and a peer that left loses its connection. A peer that crashes leaves when its presence expires. So the `rtc` channel decides nothing about membership (`protocol.ts` header).

**Messages** (`CallMessage`): `description` (an SDP offer or answer), `ice` (a candidate) and `reset`. Each message has `v` (`CALL_PROTOCOL_VERSION = 1`), the `call` id (a space can have more than one call), and `CallGenerations`, which name the connection that sent the message and the connection it is for. `parseCallMessage` drops a message with a different `v`, and returns `null` for an unknown kind. An old peer therefore ignores a new kind and does not fail.

**Negotiation:** perfect negotiation. In each pair, one peer is polite and one is impolite, decided by comparing ids. On a collision, the impolite peer ignores the incoming offer and the polite peer rolls back its own offer.

**An unreliable channel.** The ephemeral channel confirms only that the executor took a message, and has no order. So the mesh adds four mechanisms:
1. Per-peer serialisation (`enqueue`).
2. Candidates that arrive before a description wait for it.
3. A recovery ladder on a sweep (`CallMesh.tick`): ICE restart, then resend the description, then rebuild the pair.
4. A `reset` message, so that both peers agree to a rebuild.

The impolite peer repairs first. The polite peer runs the same ladder after twice the delay. A generation that was replaced is never accepted again.

**Local media** (`media.ts`):
- Screen share replaces the outgoing video track with `replaceTrack`, so camera and screen cannot be sent at the same time.
- Mute sets `track.enabled = false`.
- Presence carries `MediaSettings`, so peers show mute and screen state from the roster.
- `MediaDeviceAccess` and the `RTCPeerConnection` constructor are injected, so tests need no browser.

</details>

<details><summary>Where in the code</summary>

- [packages/module-system/call/src/mesh.ts](../../../../packages/module-system/call/src/mesh.ts): `createCallMesh`, `CallMesh`, `setRoster`, `tick`, `enqueue`, `placeOf`.
- [packages/module-system/call/src/protocol.ts](../../../../packages/module-system/call/src/protocol.ts): `CallMessage`, `CallGenerations`, `parseCallMessage`, `CALL_PROTOCOL_VERSION`.
- [packages/module-system/call/src/media.ts](../../../../packages/module-system/call/src/media.ts): `createMediaController`, `MediaDeviceAccess`, `MediaState`.
- [packages/module-system/call/src/mesh.test.ts](../../../../packages/module-system/call/src/mesh.test.ts): the negotiation tests with a fake connection.

</details>
