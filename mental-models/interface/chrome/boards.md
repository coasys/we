# Boards

A **board** is a `CollectionBlock` of kind `board` whose children are its columns. A column is a saved query with an arrangement: the column shows each task whose `status` matches the column's `slug`, in the order of the column's `arranges` relation. A column with no `slug` is a **board lane** that shows only the cards that a person put in it.

**Why:** The state of a task is a fact about the work, and its position is a fact about the pair of task and board. A task can be on many boards, so its state cannot come from its position. So work that an interpretation pass writes appears on each board with no board write, and a board renders one answer when its links disagree after a partition (`boards.md`).

**Parent:** [Chrome](README.md)

<details><summary>How it works</summary>

1. `children` is ownership: when a board is deleted, its columns go with it. `arranges` is position: a column arranges cards that it does not own, so a deleted column cannot delete a card.
2. `gathers` on the board names where its cards come from: the space collection (the **Everything** board), a container, or nothing (a board that a person made).
3. A drop on a bound column writes the task's `status`, so every board follows. A drop on a board lane writes one link on this board only.
4. **Unplaced** holds the work in scope that no column on this board shows, and the board offers a column for each of its states.
5. `arrangedBoard` is a host source that calculates the columns, their contents, the unplaced work and the choices for pickers. The `taskBoard` fragment only arranges what `arrangedBoard` returns.
6. `createBoardActions` holds the board actions on `spaceStore` (`createBoard`, `openBoardFor`, `addBoardColumn`, …). A move from one column to another is one batch. `spliceSubsetOrder` keeps the slots of cards that a filter hides.
7. The order in a column is an ordered relation, so two people who arrange one column get the same order on every peer.

Declared relations such as `children` and `arranges`: [Relations](../../data/entities/relations.md).

</details>

<details><summary>Where in the code</summary>

- [boards.ts](../../../packages/app-shell/src/shared/boards.ts): `createBoardActions`, `BoardActions`, `CreateBoardOptions`; [boardOptimism.ts](../../../packages/app-shell/src/shared/boardOptimism.ts).
- [arrangedBoard.ts](../../../packages/app-shell/src/shared/sources/arrangedBoard.ts): `arrangedBoard`, `ArrangedBoard`; [sources/index.ts](../../../packages/app-shell/src/shared/sources/index.ts): the host sources.
- [taskBoard.ts](../../../packages/templates/kit/src/we/taskBoard.ts): the `taskBoard` fragment.
- [BoardsView](../../../packages/templates/views/src/views): the `boards` view.
- [docs/architecture/boards.md](../../../docs/architecture/boards.md): boards in depth.

</details>
