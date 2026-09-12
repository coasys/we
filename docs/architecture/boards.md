# Boards

How work is arranged in WE, and why the arrangement is a different fact from the work.

This is the reasoning behind `taskBoard` in `@we/template-kit`, `arrangedBoard` in the app shell's
host sources, the board actions on `spaceStore`, and the `Boards` view. Read it before changing any of
them — most of what follows is decisions that look arbitrary from the code alone, and three of them
are the difference between a board that loses work and one that cannot.

## The founding decision

> **State is a fact about the work. Position is a fact about the pair.**

A `TaskBlock.status` is read by every surface in WE — the boards, an agent through MCP, a peer's
node, a view written next year. Where that task sits on _one_ board is that board's business alone.

The scenario that settles it: the same task on a community sprint board and somebody's personal
board. One person drags it to Done. On the other board it sits under "Thursday". Is it done?
Obviously yes — so state cannot be derived from position, because position is plural the moment a
second board exists.

Everything below follows from that one sentence.

## Board and kanban are not two words for one thing

> **A board is the record. Kanban is the arrangement.**

A board is a `CollectionBlock` holding columns — the thing `spaceStore.createBoard` makes,
`openBoardFor` finds, `addBoardColumn` adds to and `arrangedBoard` works out. Kanban is one way of
_reading_ one: cards in columns standing for states, moved across as the work moves. `KIND.board`
has said so all along, calling it "a kanban board holding columns" — kanban is the adjective and
board is the noun.

So the code says **board**, everywhere and without exception: the predicate `we://board`, the stored
`kind`, every store action, the `taskBoard` fragment, the `boards` view id. Those are records, API
and stored values; renaming any of them is a migration or a silent breakage, and there is nothing to
gain from it, because the two words were never competing.

What readers see is a separate question, answered per surface:

- **The `Boards` view says "Boards".** It lists board _records_ and has a picker, which is what the
  plural noun is for — and nothing sits beside it that the word could be confused with.
- **The Workshop template's tab says "Kanban".** It is the one surface in WE where the freeform
  spatial arrangement and the column-per-state arrangement are _adjacent tabs_, and Miro, Trello and
  Jira all call one or the other a board. "Canvas | Board" asks somebody to tell apart two things
  the word covers equally well; "Canvas | Kanban" does not.

**This is a distinction, not drift — do not "fix" it in either direction.** Renaming the code to
kanban discards a useful noun and costs a data migration; renaming the Workshop's tab to Board
reintroduces the ambiguity it was changed to remove. If a space's sections ever grow a canvas
beside the `Boards` view, that view faces the same question this template already answered.

## The structure

```
Board      CollectionBlock { kind: 'board', gathers? }   children ⇒ its columns, in order (owned)
 │                                                        arranges ⇒ cards it holds in no column
 └─ Column CollectionBlock { kind: 'column', slug? }      arranges ⇒ its cards, in order (positioned)
      ⇢ TaskBlock…                                        (owned by the space, or by a call)
```

Two relations, and the difference between them is the whole design.

**`children` is ownership.** Every walker in the codebase reads it that way: `deleteBlocks` recurses
through it, `reconcileBlocks` diffs against it, the graph's collection expander opens it, an `include`
on a call returns it. A board's columns are its children because that is true of them — delete the
board and the columns should go.

**`arranges` is position.** A column arranges cards it does not own. The cards live wherever they
live — loose in the space, or as a call's children — and the column holds an ordered list of them.
Deleting the column therefore cannot reach a card, by construction rather than by any code being
careful. Before `arranges` existed a column's cards sat in its `children`, and the only thing saying
"these are not owned" was `kind: 'column'`, a free label registered nowhere. `deleteCollection` on a
call whose board held a card from elsewhere would have deleted that card. A fact that changes what
code may do to a record travels with the record, or the link — the same argument the `mode` field
makes — and this is that fact, on the link.

## What a board gathers

A board's **candidate cards** and a column's **membership** are different questions, and conflating
them was a real bug: every board showed the whole space, so a hiring pipeline and a content calendar
were one card set with different column headings.

| Board                              | `gathers`        | Its cards                                        |
| ---------------------------------- | ---------------- | ------------------------------------------------ |
| **Everything**                     | the Space record | all work in the space — the catch-all            |
| **A container's board** (a call's) | that container   | that container's work, so extraction lands on it |
| **One somebody made**              | nothing          | only what somebody put on it                     |

`gathers` is **on the board**, and it used to be inferred. Which board was canonical for a container
was a fact the container held (`Space.board`, `CollectionBlock.board`), and every surface that
rendered a board compared the open board against that link to decide whether it gathered: the Boards
view computed it, the Workshop passed a literal, and a third surface — an agent, a record page, a
mobile view — would have had to learn the rule or silently show everything or nothing. The two facts
are separable. **Canonical-ness stays on the container**, as a single-valued link, because two boards
claiming to be _the_ one is a race that has to converge. **What a board draws from is the board's own
fact**, because two boards both gathering from a call is merely two boards showing the same work. A
board that knows what it gathers can be rendered by anything that has its id.

A made board's **membership is the union of its columns' `arranges` and its own** — no separate
relation to keep in step. Placing a card anywhere on the board makes it a member; which _column_ shows
it is still its `status`, so a member marked done elsewhere moves to that board's done column rather
than falling off it, and one whose state no column here names drops to Unplaced. The board arranging
cards **directly** is how a made board keeps work that is on it but in no column — what a deleted
column leaves behind.

**Curating is safe only because Everything exists.** It gathers, it is unanchored, and nothing in the
space can hide from it — so a card nobody has triaged is always somewhere, and every other board is
free to hold only what it is about. That is the whole reason the catch-all is a _board_ rather than a
fallback inside every board. It is also why a board with no record shows **nothing** rather than
everything: the view gates on `boardLoaded`, so that state reads as loading, and an empty made board
stays distinguishable from a broken one.

## Two kinds of column

A column carries a **`slug`**: the `status` value it stands for. That single field is what makes a
column one of two quite different things.

|                   | **Bound column** (`slug` set)                           | **Local lane** (`slug` empty)                       |
| ----------------- | ------------------------------------------------------- | --------------------------------------------------- |
| What is in it     | every task whose `status` matches, plus its arrangement | only what somebody put there                        |
| Dropping a card   | writes `status` — **every board follows**               | writes one link — this board only                   |
| New matching work | arrives on its own                                      | never arrives on its own                            |
| On other boards   | their column for that slug shows it                     | invisible there; the card sits in its status column |

A lane is how somebody organises without imposing: "Thursday", "Waiting on Ana", "Discuss at
standup". Never filling itself is the price of claiming no shared meaning, and it is the right
price — a lane called "Thursday" has no business collecting extracted work. A lane that turns out to
matter is **promoted** by naming it in Settings → Vocabulary, which makes it a slug and gives it a
`semantic`; from then on it behaves like any other bound column, on every board.

A card placed in a lane is excluded from the status columns **on that board only**, or it would
appear twice.

**A board of lanes is the containment kanban.** The showcase's Boards template — columns of composed
posts, where a card's column is simply where it sits — is the same `taskBoard` fragment over another
entity with `lanesOnly` set. There used to be a second fragment for it in the portable kit; it was the
special case of this one where nothing binds, and two things called kanban with different membership
rules was a trap for anybody authoring a template.

**A bound column stores no title of its own** unless somebody renames it on that board. Its heading
reads the state's _current_ name, so a state renamed in the vocabulary renames its column on every
board. Storing the name at creation froze the vocabulary as of the day each board was made.

## Why a _gathering_ board's membership is a query and not containment

The obvious design is pure containment: a card is in To-do because To-do's list holds a link to it.
It is rejected, and not because the link is hard to write — an extraction pass knows which call it
ran on and could write it in a few lines. It is rejected for four reasons that all follow from
membership _being_ the link:

1. **Membership would have to be maintained per board, forever.** A board created tomorrow is empty
   of yesterday's work unless creating a board backfills links from every existing task. Every new
   board is a backfill; every new task is a fan-out across every board that should show it.
2. **The fan-out is one member's node writing into everybody's containers.** Extraction runs
   wherever the election lands. That node would write into boards it has not synced, or that were
   made while it was offline.
3. **The failure modes are opposite, and this is what decides it.** When containment goes wrong the
   task is _invisible_ — "in the space but on no board" is a negative over link sets and no query
   finds it. When the query design goes wrong the task shows up somewhere obvious: its status
   column, or the unplaced column. **Silently gone versus visibly misfiled** is not a close call for
   a system whose point is that a community's work survives.
4. **The common case costs nothing.** A pass writes N tasks and zero board writes.

So: **a column is a saved query with an arrangement.** Keep that sentence in mind whenever the
design looks like an awkward hybrid — a smart playlist you can also hand-order is the same shape,
and it is well understood.

The same rule decides how a **new state** reaches boards. Fanning a column out to every board when a
state is named is the write pattern above. Instead the space's own board gains the column when the
state is named — one write, by the one person who acted, on the one board whose job is to show all
the work — and every other board offers "add a column for this state" from its Unplaced column the
first time work in that state turns up there. A board somebody made is theirs to shape.

## Why this survives a partition

The property worth stating on its own, because it is what the design buys:

> The link state can be inconsistent and the board still renders exactly one answer.

Two people drag the same card to different columns while partitioned. The `status` scalar converges
(last write wins). The links may end up saying the card is in **both** columns or in **neither** —
and either way it displays in exactly one place, because status decides which column shows it and
hints are advisory. A stale hint in a column whose slug no longer matches is ignored, and cleaned up
the next time anything writes that column.

Containment has no such fallback: inconsistent links there mean a card that is genuinely nowhere.

## Ordering

Card order within a column is `arranges` on an ordered relation:

```ts
arranges: { target: '', cardinality: 'many', predicate: 'we://arranges', ordered: true }
```

That is an RGA in the executor (`rust-executor/src/perspectives/ordering/linked_list.rs`): each
entry is `{item, after, pid}`, one winner per item by highest pid, concurrent inserts fork and
linearise deterministically. Three things follow that this design depends on:

- Two people arranging the same column converge, **to the same answer on every peer** — the pid
  tiebreak exists so that link arrival order, which peers do not share, cannot decide it.
- The executor **diffs** before writing, so assigning the whole array emits entries only for what
  actually moved. Writing a column's full order does not stomp a concurrent move of a card you did
  not touch.
- Nothing is deleted; superseded entries are never selected. So a partition merges on rejoin.

**A `position` scalar was refused for the obvious reason**: two people reordering write the same
number and one answer is lost. So was holding the order in a JSON blob on the board — that is a
read-modify-write on one field, so two people arranging _different_ columns would clobber each
other. Conflict-free ordering is why each column needs its own identity, which is why columns are
records rather than configuration.

**The strategy is not baked into WE.** `RelationSchema.ordered` is a boolean in the neutral manifest
and the AD4M generator turns it into `linkedList`. When ad4m gains other strategies, widening that to
name one is two files — the manifest type and the generator — and nothing else in WE reads it. WE's
contract with the ordering is only _assign an array, read an array_.

When writing an order, write **the column's whole order** and let the executor's diff decide what
actually moved. Ids still in `arranges` that the column no longer shows (stale hints for cards whose
state changed elsewhere) follow after it; where they sit cannot matter, since nothing displays them.
What to avoid is writing an order that moves cards nobody touched, which claims positions and can
overwrite somebody else's concurrent drag.

**The whole order is not always what `we-sortable` hands over.** A column showing all of itself
hands over all of itself, and that used to be the only case. A column showing _part_ of itself —
the people filter hiding cards, or one person's row — hands over only the part, and "that, then
everything else" sends every card the reader could not see to the bottom of the column, for
everyone, with nothing on screen to say so. So every drag also passes the column's order as the
board draws it unfiltered (`contents[column].order`), and `spliceSubsetOrder` puts the moved cards
back into the slots they occupied: hidden cards keep theirs, and a card arriving from another column
is seated beside the visible neighbour it was dropped next to. A column showing everything hands
over the same list either way, so the splice changes nothing there.

**A move is one transaction.** Leaving one column, joining another and — for a bound column — the
status write land as a batch, so no reader catches the card in two columns or in none. Removing a
column hands its cards to the board and deletes the column in the same batch, for the same reason.

## Where the working out happens

Which cards a column shows, in what order, what is left over and what a heading says are one call:
`arrangedBoard({ board, columns, records, states })`, a function the host registers and the fragment
reads everywhere it needs a list. It answers with the caller's own column and card objects — never
copies — because the renderer keys `$each` rows by reference, and a fresh object per push would
remount every column and the sortable inside it on every change anywhere.

It was expressions first — a nested comprehension per column, the same string inlined in a heading's
count and an `$each`'s items — and twice it computed the wrong thing where nothing could see. The
routing table sends computation the library lacks to a host function; the tests moved with the
rules and gained types (`app-shell/tests/arrangedBoard.test.ts`).

The fragment feeds it **three subscriptions**: the board (its `children` hydrated, for the column
order), the columns as records of their own (for their contents), and everything in scope (the pool).
Two for the structure rather than one because a card moving between columns changes a _column's_
links and not the board's, so a subscription on the board alone is not obliged to re-run and a card
hydrated through it could stay as it was. That is the client library's invalidation behaviour; the
function's docblock records it so the fragment need not.

**The pool is unbounded.** A limit on it was the one place this design broke its own rule: the card
past it did not land in Unplaced, it vanished. A board that outgrows one subscription wants paging,
which is a different feature.

## Who is on the work

A board with `people` also reads the `Involvement` records — one person's part in one record, see
`docs/architecture/relations.md` — and draws it three ways, all worked out in `arrangedBoard`:

- **Faces on each card**, by what a kind _means_ rather than its slug, so "Assigned" renamed to
  "Owner" still draws as the assignee. And a menu to change them, one group per kind.
- **A filter above the board**: members to choose, and how the rest are drawn.
  - **Dim**, the default. Nothing moves, so a filtered board keeps its shape and every column still
    says how loaded it is — which is the reason it is the default rather than a nicety.
  - **Hide.** The others leave the columns; a heading reads "2/5", matched of total.
  - **A row per person.** The headings once, then a band per chosen person — or, with nobody chosen,
    per person on any card here — plus one for work nobody is on. A card two people are on is in
    both rows, which is true.

Three decisions that look arbitrary from the code:

**Declined is not being on it.** A "not going" never matches a filter, and never puts somebody in a
row.

**A drag in a row changes state and never person.** Each band's cells trade cards only with each
other. Moving a card from Ana's row into Ben's would have to mean reassigning it, which is a claim
somebody makes about another member — the card's menu makes that claim, deliberately, and a gesture
aimed at a column should not make it as a side effect.

**The chosen people are in the address and the mode is not.** `?who=` is view state a link should
carry — "look at what Ana is on". Dim or hide is a way of reading, remembered per device, and a link
should not impose it.

**`participants` is not this.** A call's roster is membership a machine observed; an involvement is
intent a person stated. The board, the calendar and anything else asking "who is on this" read
involvements.

## Boards a person does not create

- **Everything** — the space's own board, gathering from the Space record and pointed at by
  `Space.board`. Made the first time somebody opens it.
- **A call's board** — gathering from the call, parented to it so an anchored Boards view lists it,
  and pointed at by the call's `board`. Made by **the first extraction pass that leaves the call
  holding a task** — not when somebody opens the route.

Neither is created on a route mounting. Writing records into a space everybody shares as a side
effect of navigating would have every member who opened the tab racing to create the same board; a
pass runs on exactly one node, and Everything is made by a deliberate click.

The rule for a call's board is "once it holds a task" rather than "once a pass produced anything", so
an events-only call does not get an empty kanban nobody can explain. `InterpretationResult` carries
ids and no types, so one query decides it — after an LLM round trip, where its cost is nothing. See
`ensureBoardFor`, reached through the host's pass-settled hook, which names a collection and nothing
else like every other member of that surface.

Two people clicking at the same moment on two nodes still create two records — there is no
coordination point — but only one is ever _the_ board, because `Space.board` and
`CollectionBlock.board` are single-valued and converge. The loser is indistinguishable from a board
somebody made, which is a harmless outcome rather than one needing a rule nobody would remember.

## Rules that are easy to break

**Deleting a column must never delete its cards.** `arranges` makes this true by construction — no
walker follows it — but only so long as a column's cards stay _there_. Never put a card in a column's
`children`.

**And on a made board the cards must be handed up to the board first.** On a gathering board deleting
a column loses nothing on its own, because the board draws from everything in scope. On a made board
membership _is_ arrangement, so the column being deleted held the only record that its cards were on
the board at all. `removeBoardColumn` moves them to the board's own `arranges` in the same batch that
removes the column. Nothing decides which column they belong in, because nothing has to: a column
bound to their state gathers them back as unarranged, and Unplaced catches the rest.

**Reads must tolerate a dangling child.** A board's `children` can name a column another agent
deleted. `arrangedBoard` renders nothing for it rather than a hole.

**Where new state goes**, so the entity does not accrete a scalar per feature:

| The state            | Where it lives                                     |
| -------------------- | -------------------------------------------------- |
| Queryable identity   | a scalar field (`kind`, `type`, `slug`)            |
| Concurrently edited  | an ordered relation (`children`, `arranges`)       |
| What a board reads   | a relation (`gathers`)                             |
| Single-setter config | one JSON bag, added when the first consumer exists |

`slug` earns a scalar because it is queried and compared. A WIP limit, a per-board colour override, a
collapsed-by-default flag are all single-setter config and belong in a bag — not in three more
columns on `CollectionBlock`, which its own docstring warns against.

**And `type` is not the place for any of it.** It is the _structural_ node type that the serializer
round-trips; semantic values there are the mistake its own documentation names, citing the transcribe
module writing `tag: 'transcript'` into `TextBlock.style`. Which board is canonical was briefly
`type: 'space'` / `type: 'anchor'` and is a relation now, which is both correct and convergent.

## What is not built, and how it fits

- **Swimlanes other than by person.** A row per person is built, and was exactly the client-side
  partition this entry predicted: no data, a second argument to `arrangedBoard`. Rows by priority are
  the same move over a scalar. Arbitrary named rows ("Design", "Backend") still need row records and
  a second binding on the group — additive, not a restructure.
- **WIP limits, per-board filters, saved views.** Single-setter config; see the table above. A saved
  view is where `gathers` is heading: a board whose pool is a query rather than a container.
- **Moving cards between boards in bulk.** The add-card modal pulls one card in at a time. The Pocket
  is the right surface for several, and is closed to a template on purpose: `modules.pocket.gather`
  is chrome-only because the Pocket writes to the agent's own root dataset, and a space template
  arriving from a stranger must not file things there or enumerate what somebody keeps. The
  interaction it leaves open — a button that opens the panel, and the person drags the card in —
  needs drag arbitration `we-draggable` and `we-sortable` do not have, since both claim
  `pointerdown`.
- **"On no board yet".** Everything shows all the work but cannot distinguish a card nobody has
  triaged from one already on three boards. That filter is a cross-board question; it wants a store
  accessor, and is worth building when somebody feels the lack.
- **Paging.** The pool is unbounded and one subscription. Past a few thousand cards a board wants
  to page, and `arrangedBoard.total` is where a surface would learn it should.
- **Sub-tasks.** `TaskBlock` has no `children`; it would need one, or a parent link. Nothing about
  the board changes.

## Where the pieces are

| Piece              | File                                                                                                                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The board fragment | `packages/templates/kit/src/we/taskBoard.ts`                                                                                                                                                                                                   |
| The working out    | `packages/app-shell/src/shared/sources/arrangedBoard.ts`                                                                                                                                                                                       |
| The view           | `packages/templates/views/src/views/BoardsView/index.ts`                                                                                                                                                                                       |
| The writes         | `packages/app-shell/src/shared/boards.ts`, surfaced on `spaceStore` — `createBoard`, `openBoardFor`, `addBoardColumn`, `removeBoardColumn`, `renameBoardColumn`, `reorderBoardColumns`, `arrangeColumn`, `moveCardToColumn`, `addTaskToColumn` |
| The vocabulary     | `packages/entities/src/manifest/TaskState.ts`, and Settings → Vocabulary                                                                                                                                                                       |
| Who is on the work | `packages/entities/src/manifest/Involvement.ts` and `InvolvementType.ts`; the writes in `packages/app-shell/src/shared/involvements.ts`; the read in `sources/involvement.ts`; the filter in `packages/templates/kit/src/we/peopleFilter.ts`   |
| The order splice   | `packages/app-shell/src/shared/shapes/subsetOrder.ts`                                                                                                                                                                                          |
| The anchor         | `packages/templates/kit/src/we/anchor.ts`                                                                                                                                                                                                      |
| The showcase       | `packages/templates/showcase/src/KanbanTemplate.schema.ts` — the same fragment, over posts, as lanes                                                                                                                                           |
