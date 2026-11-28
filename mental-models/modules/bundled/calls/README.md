# Calls

The call module (`@we/module-call`) runs audio, video and screen-share calls in a space. A call is its **call record**: a `CollectionBlock` with `kind: 'call'` and `mode: 'feed'`, which the call writes when it starts. The call id is derived from the record id (`recordCallId`, `call:<recordId>`).

**Why:** Because the call id comes from the record, a call needs no other identity, and everyone who continues the same record lands in the same call (`continueCall` comment). The record is in the call's `presence` activity, so transcription writes into the right record without electing a creator, and the record survives the starter leaving (`publishActivity` comment). The module declares no framework: live video uses the `we-video` primitive's `stream` property (`index.ts` header).

**Parent:** [Bundled modules](../README.md)

## Parts
- [Mesh](mesh.md): one `RTCPeerConnection` per peer over the ephemeral channel, the call protocol, and local media.
- [Backend sessions](sessions.md): the `call` kernel, mesh or SFU topology, and the space's call policy.
- [Live](live.md): the live module, which shares cursors and lets one participant drive the others' view.

<details><summary>How it works</summary>

The store joins three collaborators, and the data goes one way (`store.ts` header):

```
presence  (who is in the call: the 'call' activity, which expires on TTL)
   │ roster
   ▼
mesh or backend session  (connections to them)  ◄── media controller (this agent's devices)
```

A failed connection is not a peer that left, so the mesh never tells presence who is in the call.

- `startCall(anchorNodeId?)` creates the record with `records.create`. A call about a node is filed as a response to that node (`parent: { id, relation: 'responses' }`). Any other call is top-level in the space. Then the store joins `recordCallId(recordId)`.
- `continueCall(recordId)` joins the call of a record that exists, and does not write. The activity then carries `continued: true`.
- `publishActivity` publishes `{ type: 'call', id, media, anchor?, record?, continued?, topology? }`, and each participant publishes it again when its media changes. `liveCalls` groups the peers' call activities in this space by call id.
- One call at a time: `join` ends the call that runs before it starts a new one.
- `holds: 'active'` keeps the call's chrome on screen in a space that does not enable calls.

Contributions:
- The `stage` panel, whose bid comes from the store (`stageBid`).
- Slots in `dock-bottom` (`problem`, `audioSink`, `stageStrip`) and in `overlay` (the device settings).
- A launcher ("Start call" / "Go to the call").
- The parts `startCallButton`, `anchoredCallButton`, `continueCallButton`, `renameCallButton`, `deviceSettings` and `tile`.
- The anchors `call-controls`, `call-menu`, `call-status`, and `call-dev` when synthetic peers are available.
- The `iceServers` setting.

The module ships no TURN server. A deployment, a space or an agent sets `iceServers`, as URL lines or a JSON `RTCIceServer` list (`iceServers.ts`). The chosen microphone and camera are kept in `localStorage` (`devices.ts`), because a device id names a device on one machine only.

</details>

<details><summary>Where in the code</summary>

- [packages/module-system/call/src/index.ts](../../../../packages/module-system/call/src/index.ts): `callModule`, `createModule`, the anchors, panels, slots and parts.
- [packages/module-system/call/src/store.ts](../../../../packages/module-system/call/src/store.ts): `createCallStore`, `startCall`, `continueCall`, `join`, `publishActivity`, `liveCalls`.
- [packages/module-system/call/src/iceServers.ts](../../../../packages/module-system/call/src/iceServers.ts), [devices.ts](../../../../packages/module-system/call/src/devices.ts), [strip.ts](../../../../packages/module-system/call/src/strip.ts), [devPeers.ts](../../../../packages/module-system/call/src/devPeers.ts): relay parsing, remembered devices, the filmstrip layout and synthetic peers.
- [docs/architecture/transcripts.md](../../../../docs/architecture/transcripts.md): the shape of a call record.

</details>
