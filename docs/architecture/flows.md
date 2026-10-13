# Flows

A **flow** is a set of rules over a record's state: the steps a record can be at, the moves allowed
between them, and what entering a step requires — a number of people agreeing, or something being
present. A record **moves** when somebody asks for a move and what the step requires is met.

The task-state board is one flow (see [boards.md](./boards.md), "When a state asks for agreement").
The Flows page in the workshop template lists every flow in a space, shows what is going through
each, and edits them.

## The contract speaks in rules and moves

`FlowPort` (`packages/backend-system/shared/src/flows.ts`) describes the domain and nothing about how a
backend enforces it:

- **A definition** is states, transitions and, per state, `requires` — a list of rule kinds:
  `approvals` (how many, and optionally from whom: the agents named by records of an entity) and
  `guard` (records of an entity that must exist, tied to the record through one of its relations by
  name, or by a field naming it).
- **`move(flow, subject, to, { from, note })`** answers `moved`, `waiting`, `refused`
  (`not-allowed` / `unmet`), `stalled` or `pending`. Asking and agreeing are the same call. `from` says
  where a record the flow has not seen already stands, so a record that predates the flow keeps its
  place.
- **`withdraw`** takes back only the caller's own asks on moves still waiting — never a move that
  happened.
- **`watch`** reports each record's state (`null` when the backend cannot say yet), its waiting moves
  and whether it is stuck; **`history`** its steps, with the records that met the guards as evidence.
- **`list`, `read`, `remove`**; `remove` refuses while any record is going through the flow, because
  those records would be left with nothing to move them and a flow made later under the same name
  could pick them up.

What is **not** in the contract: runs, proposal ids, an entry state, a state not yet derived here.
Those are how a peer-to-peer backend works, and they stay in its adapter.

### Where backends differ, they say so

`FlowPort.capabilities`:

| Field            | Meaning                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requirements`   | The rule kinds it enforces. A definition using another is refused on install, and the editor offers only these.                                   |
| `enforcement`    | `server`: one authority applies every rule. `peers`: every member's software applies them, so a member running other software can write past one. |
| `sealedEvidence` | A move's evidence is sealed: a later edit does not change what it was agreed on.                                                                  |
| `contention`     | Two moves out of one step both agreed: `stall` leaves the record stuck until somebody withdraws; `first` lets the earlier win.                    |

A surface reads these rather than guessing — the editor says beside a rule when it is kept by
members' software rather than a server, and warns about ties where the backend stalls on them.

### The two adapters

- **In memory** (`backend-system/inmemory/src/flows.ts`) is a plain state machine, as a backend with
  one authority would hold one: each record's state, its waiting asks, its history. `server`,
  `first`.
- **AD4M** (`backend-system/ad4m/src/flowPort.ts`, `flowRuns.ts`) compiles a definition to a
  `SHACLFlow` with a hidden entry state, guards to `requires` with `linkedTo` (the relation's storage
  predicate, looked up by name), and reads the engine's runs and proposals back as records. It reads a
  definition back with `fromShaclFlow` and calls it editable only when that round-trips link for link
  — a flow another app wrote, carrying what the contract cannot hold, shows read-only. `peers`,
  `stall`, sealed.

The conformance suite (`backend-system/conformance`, `flows.*`) pins the behaviour both share.

## Editing a flow as lanes

A wiring diagram scales badly for the flows people write, so a flow is edited as **lanes**
(`app-shell/src/shared/flowLanes.ts`): a main line, branches that leave it at a step and either
rejoin at a later one or end, a **sequence rule** (`next`, `next-and-back`, `any`) and **exceptions**
for any move the rest does not cover.

Nothing about lanes is stored. A definition is written lane by lane, main line first, so the lanes are
read back out of the state order and the moves. Where a reading is ambiguous — the same moves say a
branch plus a shortcut either way round — it takes the one with fewest exceptions, then the simpler
rule, then the latest fork. A definition that does not compile back to itself is shown, not edited.

A record never branches: it takes one path. So a record is drawn as a **walk** — the steps taken, the
one it is at, the ones ahead — whatever the flow allows.

**A requirement belongs to the step being entered**, whichever move leads there. So a way out that one
person may take is a step of its own (the Proposal preset's Withdrawn), not a shortcut into a step
that asks for agreement.

## The store

`flowStore` (`app-shell/src/frameworks/solid/stores/FlowStore.tsx`) is a host store, because the
board, a record's inspector and the Flows page all call it. Its logic is in three framework-neutral
files beside `flowLanes.ts`: `flowDraft.ts` (every edit to a flow being written, and the presets) and
`flowViews.ts` (steps, requirements and a record's walk, in words). Saving, deleting and archiving are
for whoever administers the space; anybody may start a flow on a record, ask for a move and take back
their own ask. Archived flows are listed on the space (`Space.archivedFlows`).

The task-state flow is listed and shown read-only: it is written from the space's task states and
moved on the board.

## Not built yet

- Flow-level AI context, a step's AI check (`semanticCheck`) and a final step's outputs with
  receipts — AD4M has all three; the contract does not carry them yet.
- The board over any flow, with task states only its display details.
