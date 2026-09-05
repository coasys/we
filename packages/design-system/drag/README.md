# @we/drag

The drag **session** and the drag **payload**. Not the gestures.

## What belongs here

- **The session** (`session.ts`) — what is in flight, what is under the pointer, what happens on
  release, how it is cancelled, and the keyboard path. One at a time, per window.
- **The payload** (`types.ts`) — a drag carries **references**, `{ dataset?, entity, id }`, never
  DOM. That is what makes a thing droppable somewhere its source has never heard of.
- **The parts every surface had to solve alone** — the ghost, the drop line, the top layer, the zone
  registry with innermost-wins hit-testing, autoscroll, spring-loading, the press-to-drag threshold
  and the touch long-press.

Agnostic: no framework, no backend, no `@we/*` dependency at all. It is DOM and arithmetic.

## What does not belong here

- **A gesture.** What counts as picking something up is surface-specific and correctly so — the
  graph arbitrates a press against pan and zoom, the editor's handle is also the OS file-drop path,
  a card is just a card. Each mechanism _feeds_ the session rather than _becoming_ it.
- **A data model.** The session carries references and hands them to a zone. What a drop _means_
  stays with the receiver: a kanban column writes a scalar, a board relinks two edges, a panel
  writes a record. A session that assumed one of those would be useless to the others.
- **Anything that reads a store.** The `dataset` half of a reference is stamped by the receiver, not
  the source, precisely so this package never needs to know what a dataset is.

## Using it

```ts
// A source, on pointerdown:
watchPointerDrag(event, {
  capture: this,
  onStart: (e) => dragSession.begin({ payload, pointer: { x: e.clientX, y: e.clientY }, from: this }),
  onMove: (e) => dragSession.move({ x: e.clientX, y: e.clientY }),
  onEnd: (e) => dragSession.drop({ x: e.clientX, y: e.clientY }),
  onCancel: () => dragSession.cancel(),
});

// A target, on connect:
const off = dragSession.registerZone({
  el: this,
  accepts: (payload) => payload.items.every((i) => this.accepted.includes(i.ref.entity)),
  onDrop: ({ payload }) => this.dispatchEvent(new CustomEvent('dropped', { detail: payload })),
});
```

Style the target off `[data-we-drop-target]`, and stand hover chrome down while
`html[data-we-dragging]` is set.
