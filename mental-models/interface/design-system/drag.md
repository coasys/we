# Drag

`@we/drag` holds the drag session and the drag payload. A **drag payload** carries references `{ dataset?, entity, id }`, never DOM elements. The package does not define the gestures that start a drag.

**Why:** A payload of references lets a person drop a thing on a target that its source does not know. What a drop means stays with the target: a board column writes a status, a panel writes a record. The package has no framework, no backend and no `@we/*` dependency, so any surface can use it (`drag/README.md`).

**Parent:** [Design system](README.md)

<details><summary>How it works</summary>

1. `dragSession` holds one drag at a time for each window. A source calls `begin`, `move`, `drop` and `cancel`. `watchPointerDrag` gives the press-to-drag threshold and the touch long-press.
2. A target calls `dragSession.registerZone({ el, accepts, onDrop })`. The zone registry finds the zone under the pointer, and the innermost zone wins.
3. The target, not the source, sets the `dataset` part of a reference, so the package never reads a store.
4. The package also holds the ghost, the drop line, autoscroll and the top-layer handling that every surface needs.
5. The document has `data-we-dragging` during a drag, and a target under the pointer has `data-we-drop-target`, so CSS can style both.

</details>

<details><summary>Where in the code</summary>

- [packages/design-system/drag/src/](../../../packages/design-system/drag/src): [session.ts](../../../packages/design-system/drag/src/session.ts), [types.ts](../../../packages/design-system/drag/src/types.ts), [zoneRegistry.ts](../../../packages/design-system/drag/src/zoneRegistry.ts), [pointerDrag.ts](../../../packages/design-system/drag/src/pointerDrag.ts), [ghost.ts](../../../packages/design-system/drag/src/ghost.ts), [dropLine.ts](../../../packages/design-system/drag/src/dropLine.ts), [autoscroll.ts](../../../packages/design-system/drag/src/autoscroll.ts).
- [packages/design-system/drag/README.md](../../../packages/design-system/drag/README.md).

</details>
