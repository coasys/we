# Backend sessions

Where the connected backend can run a call, the call module uses the `call` kernel: `calls.session(callId, request)` returns a `CallSession`, and the backend runs the topology, signalling, roster and peer connections. The module then only starts the session, ends it and reads its participants. Where `calls.available()` is false, the module runs its own [mesh](mesh.md).

**Why:** `CallSession` is a structural type in `@we/module-shared`. The backend's session satisfies it, so the call module has no import of any backend (`store.ts`, "Session backend"). The module names a space by its `datasetUri`, and the host finds the dataset. A session that names its space and finds it not joined is refused, so a participant who follows a topology switch from another space cannot reconnect into a call that nobody is in (`callKernel.ts` header).

**Parent:** [Calls](README.md)

<details><summary>How it works</summary>

**The kernel** (`CallKernel`):

| Member | What it does |
|---|---|
| `available()` | True when the backend has a call port. |
| `session(callId, { iceServers, topology, datasetUri })` | Builds the backend's session in the named space, or in the space on screen. |
| `config()` / `setConfig(config)` | Reads and writes the call policy of the space on screen. |
| `configurable()` | True when the space on screen has a call policy (not a personal space). |

**Topology.** `CallTopology` is `mesh` or `sfu` (a relay server).
- The space's policy decides only how a new call starts.
- Each participant publishes `CallTopologyChoice` `{ mode, at, by? }` in its call activity. A joiner adopts the newest one (`newestCallTopology`), so a change of the setting during a call cannot split the call.
- `switchTopology(mode)` sets `by` to this agent, publishes, and calls `reconnectSession`, which ends the session and builds a new one. If that fails, it tries the previous topology again and says which one it is on.
- Other participants follow only a choice that has `by`, so a call reconnects only because a person asked.
- The choice is not stored and ends with the call.

**Policy.** `CallConfigState` is `{ mode, maxMeshParticipants }`. `CallConfigMode` is `mesh`, `designated`, `gateway` or `cascaded`. The default (`MESH_POLICY`) is `mesh` with 6 participants. `callPolicy` keeps only these two fields, because a read also returns the executor's own settings (cascade peers, capacity, preferred node), and the executor refuses them on a write. `setNewCallsUseSfu(true)` writes `designated`, and `false` writes `mesh`.

</details>

<details><summary>Where in the code</summary>

- [packages/module-system/shared/src/call.ts](../../../../packages/module-system/shared/src/call.ts): `CallKernel`, `CallSession`, `CallSessionRequest`, `CallParticipant`, `CallQuality`.
- [packages/app-shell/src/shared/callKernel.ts](../../../../packages/app-shell/src/shared/callKernel.ts): `createCallKernel` over the backend's `CallPort`.
- [packages/module-system/call/src/store.ts](../../../../packages/module-system/call/src/store.ts): `CallTopology`, `CallTopologyChoice`, `newestCallTopology`, `switchTopology`, `reconnectSession`, `connectSession`, `CallConfigState`, `MESH_POLICY`, `callPolicy`.
- The backend's call port: [Backend contract](../../../data/backend/README.md).

</details>
