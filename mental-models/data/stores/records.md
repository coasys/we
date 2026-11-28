# Records

`RecordStore` creates one record of any entity, whatever the entity is, and arranges records on canvases. Its canvas undo is **history** (`@we/history`): a private stack of this agent's own inverse writes, applied as new forward writes.

**Why:** A form over an entity chosen at runtime has field names that no template knows, so `$localState` cannot hold its draft; the store can. Undo on shared, last-write-wins data cannot restore a snapshot, because that discards a peer's change made in between. So undo is "put that back", not "rewind time": it is one more write, on the same terms as every other write.

**Parent:** [Stores](README.md)

<details><summary>How it works</summary>

1. `creatableEntities` lists what a person can create in this space, and changes with the shapes the space defines. `openRecordForm`, `setRecordField` and `saveRecord` drive one draft (`recordDraft`). `displays[type]` says which property is the title, the summary and the picture, so a template can show a record of a type it was not written for.
2. Canvas actions (`placeOnCanvas`, `dropOnCanvas`, `resizeOnCanvas`, `setCardStyle`, `removeFromCanvas`, …) are scalar upserts on a `Placement`.
3. Each arrangement write pushes a history entry. An entry is closures from the store: `undo`, `redo`, `stale`, with a `scope` and a `label`. `@we/history` owns only the order, the scope and the stale rule.
4. `undoCanvas(canvas)` and `redoCanvas(canvas)` take the canvas as an argument and point the stack at it (`scopeTo`). A change of scope clears both stacks. An entry whose record a peer has moved since is `stale` and is dropped, not applied.
5. `canvasHistory` is `{ canUndo, canRedo, undoLabel, redoLabel }`. The stack holds at most 50 entries by default and is never written to the space.
6. `deleteRecords` deletes a set of records in one write group, after one host confirmation. It is outside the history: on AD4M a delete drops the links and a re-create gets a new id, so the relations to the old record break.
7. Card styles and drawn connections show at once through two `createOptimism` instances ([Optimism](optimism.md)).

Defining a shape is `ShapeStore`'s work, not this store's ([Shapes](../spaces/shapes.md)). Posts are composed through the block composer ([Modules](../../modules/README.md)).

</details>

<details><summary>Where in the code</summary>

- [packages/app-shell/src/frameworks/solid/stores/RecordStore.tsx](../../../packages/app-shell/src/frameworks/solid/stores/RecordStore.tsx): `RecordStore`, `canvasHistory`, `undoCanvas`, `redoCanvas`, `deleteRecords`.
- [packages/history/src/index.ts](../../../packages/history/src/index.ts): `createHistory`, `History`, `HistoryEntry`, `HistoryState`, `EMPTY`.

</details>
