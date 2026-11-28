# Live

The live module (`@we/module-live`) shows each participant's pointer to the others (live cursors) and lets one participant drive: the others can follow that participant's screen. It stores nothing. It uses the `presence`, `ephemeral` and `view` kernels.

**Why:** Cursors and driving are the same data, "what this person's screen does", at two rates. Both use one channel, both expire through presence, and the host draws both (`index.ts` header). The module never names the call module: its controls go into the anchors that the call module opens, so a third module can join the same menu.

**Parent:** [Calls](README.md)

<details><summary>How it works</summary>

**Who is where is presence.** The channel has no join, leave or roster message. The module declares three activities:

| Activity | Shape | Meaning |
|---|---|---|
| `live` | `{ cursors: true }` | My cursors are on, so send me yours. |
| `driving` | `{ since }` | I have the wheel. The earliest `since` wins. |
| `following` | `{ id }` | I follow this driver. |

Presence expires on a TTL. So a driver who closes the laptop releases every follower, and nobody sends a message (`protocol.ts` header).

**What the channel carries.** Two ephemeral channels, `live` and `live-view`, both coalesced. A `LiveMessage` is `{ v, seq, kind: 'cursor', at }` or `{ v, seq, kind: 'view', frame }`.
- `seq` increases for each sender and kind. A receiver drops a message that is not newer, because sends can arrive out of order.
- `parseLiveMessage` drops a different `v` and returns `null` for an unknown kind.
- A cursor older than `CURSOR_TTL_MS` (3 s) is not drawn. A driver sends the view again every `VIEW_REPEAT_MS` (2 s), for a follower who joins while the driver does not move.
- `cursorIntervalMs` sends a moving pointer every 80, 160 or 320 ms, for up to 4, up to 8, or more watchers.

**The `view` kernel** is the host's part (`LiveView.tsx`). A `LiveAnchor` places a point in a frame (`surface`, `kind` = `world`, `record` or `viewport`, `x`, `y`), so that two different screens agree on it. A `ViewFrame` is the whole address with its query string, and the visible region of the surface. The kernel has `onPointer`, `frame`, `apply` and `decorate`. `apply` is the only way the module moves an agent, and it can only give back a frame that it received.

**Following stops** when the follower navigates, moves the region or scrolls to a different record (`followRelease`, after `SETTLE_MS`).

**Contributions:** menu items in `call-menu`, the driver strip and a problem strip in `call-status`, the parts `cursorToggle`, `wheelButton` and `driverStrip`, and the launcher "Follow the driver" (`availableWhen: 'canFollow'`). Settings: `cursors` (`restrict`, at deployment, space and agent-in-space) and `driving` (`override`, at deployment and space). The cursor switch itself is for the session only and is not stored.

</details>

<details><summary>Where in the code</summary>

- [packages/module-system/live/src/index.ts](../../../../packages/module-system/live/src/index.ts): `liveModule`, the slots, launcher, activities and settings.
- [packages/module-system/live/src/protocol.ts](../../../../packages/module-system/live/src/protocol.ts): `LiveMessage`, `parseLiveMessage`, `followRelease`, `cursorIntervalMs`, `CURSOR_TTL_MS`, `VIEW_REPEAT_MS`.
- [packages/module-system/live/src/store.ts](../../../../packages/module-system/live/src/store.ts): `createLiveStore`, `takeWheel`, `toggleFollow`, `toggleCursors`.
- [packages/module-system/shared/src/kernels.ts](../../../../packages/module-system/shared/src/kernels.ts): `ViewKernel`, `LiveAnchor`, `ViewFrame`.
- [packages/app-shell/src/frameworks/solid/components/LiveView.tsx](../../../../packages/app-shell/src/frameworks/solid/components/LiveView.tsx): the host half of the `view` kernel.

</details>
