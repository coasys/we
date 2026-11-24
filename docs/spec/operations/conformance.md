# Operations: conformance

The operations suite is a set of **vectors**: language-neutral JSON cases, each an operation, the
records a dataset starts with, an invocation, and what a conforming implementation produces from
them, the outcome and the records the dataset ends with. Another implementation runs every vector
and compares; it conforms when every vector matches.

The vectors are authoritative where this prose and they disagree ([Conventions](../README.md#conventions)).
They were recorded on the reference implementation and are re-recorded only on purpose, so a change
to one is a change to the contract.

## The file

One JSON file, `{ "version": 1, "cases": [ … ] }`. `version` is the vector file's own format
version. Each case:

| Key            | Value                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`           | The case's name, unique in the file.                                                                                                                                                                   |
| `note`         | One sentence saying what the case shows.                                                                                                                                                               |
| `manifest`     | `{ "version", "entities", "operations" }`: a manifest declaring the case's operation. Register its `operations` under the namespace `conformance`.                                                     |
| `calls`        | An object of qualified name to operation definition: every operation the case's operation calls, at any depth. Register each under the namespace its name gives (`core.thread` as `thread` in `core`). |
| `dataset`      | The records the dataset starts with: a list of `{ "entity", "id", "fields", "relations"? }`.                                                                                                           |
| `operation`    | The bare name of the operation to run; it runs as `conformance.<operation>`.                                                                                                                           |
| `args`         | The invocation's `args`.                                                                                                                                                                               |
| `invoker`      | The invocation's `invoker`. Every case uses `did:example:invoker`.                                                                                                                                     |
| `invocationId` | The invocation's `invocationId`.                                                                                                                                                                       |
| `invokedAt`    | The invocation's `invokedAt`.                                                                                                                                                                          |
| `observe`      | What to read back afterwards: a list of `{ "entity", "fields", "relations" }`.                                                                                                                         |
| `outcome`      | `{ "result": … }` when the operation succeeds, or `{ "error": { "class", "code" } }` when it fails.                                                                                                    |
| `records`      | What the reads in `observe` produce: an object of entity name to a list of observed records.                                                                                                           |

## Running a vector

For each case, on a fresh, empty dataset:

1. **Seed.** Create every record in `dataset`, with the `id` given and its `fields`. Then, once all
   exist, set each record's `relations`: each key a to-many relation, its value the members' ids in
   order. Seeding is not part of the operation and is not judged by anything the case observes.
2. **Register.** Register `manifest.operations` under `conformance`, and each entry of `calls` under
   its own namespace.
3. **Invoke** `conformance.<operation>` with `args`, `invoker`, `invocationId`, `invokedAt` and the
   dataset. Pass no `version`.
4. **Outcome.** If the operation succeeds, its result is `{ "result": r }`, with `r` the
   operation's `returns` value and `null` when it returns no value. If it fails with an operation
   error, the outcome is `{ "error": { "class": …, "code": … } }`. Messages and `step` are not
   compared. Any other failure fails the case.
5. **Observe.** Whatever the outcome, for each entry of `observe`, read every record of `entity` in
   the dataset, and for each produce an object holding:
   - `id`;
   - each field in `fields` that has a value (absent, `null` and `''` are left out);
   - each relation in `relations` that has members, as the list of its members' ids in the order the
     backend reads them (a relation with none is left out).

   Under `records[entity]`, list these sorted by `id`.

6. **Compare** the outcome with `outcome` and the observations with `records`, as JSON values: equal
   keys, equal values, lists in the same order.

**Ids are compared exactly.** A record the operation creates has an id derived from the invocation
([Ids](execution.md#ids)), so every implementation arrives at the same one, and a `result` naming a
created record names the same id. An id that differs is a failure of the derivation, not a detail.

**What is not compared.** Who wrote a record, and when (`author`, `createdAt`, `updatedAt`), are
each backend's to stamp, so no case observes them. Error messages and `step` paths are each
implementation's.

**The write check.** The vectors are recorded with no write policy in force: every write is
admitted. A case's outcome assumes the same. (Refusal is pinned by the backend suite's own cases
instead; see the footer.)

## The cases

**The runner's own rules**, over a few small operations written for the suite:

| Case                | What it shows                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `create-and-link`   | Creates and links in a `forEach`; the ids the derivation gives for a board and its columns.            |
| `forEach-keys`      | The same invocation with the list reordered: every record gets the id it got before.                   |
| `upsert-existing`   | A `find` that matches skips a `when`-guarded `create`; `returns` gives what was found.                 |
| `upsert-missing`    | A `find` that matches nothing lets the guarded `create` run; `returns` gives what was made.            |
| `rollback-on-check` | A failed `check` fails with its named precondition error, and the record made before it does not land. |
| `second-write`      | An `update` of a record created earlier in the same operation lands on it.                             |
| `strict-link`       | A strict `link` of a member fails as `alreadyLinked` and changes nothing.                              |

**WE's own operations**, run under the suite's namespace, for the shapes a community's data is
mostly made of:

| Case                           | Operation           | What it shows                                                                                                |
| ------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `core-upsert-signal`           | `upsertSignal`      | With no reaction yet, makes one under the record and answers with its id.                                    |
| `core-respond-replaces`        | `respond`           | Removes the invoker's earlier answer on this record only, and makes the new one.                             |
| `core-create-post-reply`       | `createPost`        | A reply: in its subject's responses and thread, a child of nothing, its block under it. Calls `core.thread`. |
| `core-move-card`               | `moveCard`          | A card leaves one column, joins another where dropped, and takes the bound column's state.                   |
| `core-remove-board-column`     | `removeBoardColumn` | A column's cards go to the board, and the column is deleted, never a card.                                   |
| `core-place-card`              | `placeCard`         | Edits the placement a canvas draws, removes the duplicate it outranks, answers with what it held.            |
| `core-create-task-state-taken` | `createTaskState`   | Refuses a name whose slug a retired state still holds (`slugTaken`), and writes nothing.                     |
| `core-mark-read-heals`         | `markRead`          | Moves the oldest read marker to `invokedAt` and removes a doubled one.                                       |
| `core-delete-records-any`      | `deleteRecords`     | Deletes records of two entities chosen at run time through `{ "category": "any" }`, and leaves the rest.     |
| `core-move-under`              | `moveUnder`         | Moves a record between holders through a relation named at run time.                                         |

## What a vector does not carry

A vector is meant to run without reading the reference implementation's source. Two things it
relies on are not in the file in this version:

- **The entity schemas.** `manifest.entities` is empty: the cases write WE's own entities
  (`CollectionBlock`, `TaskBlock`, `TextBlock`, `Signal`, `Involvement`, `Placement`, …), whose
  properties, relations, which relations are ordered, and which entities are `blockable`, come from
  WE's core manifest. An implementation needs that manifest to run the cases.
- **The policy.** That no write policy is in force is stated here, not in the file.

> **Planned.** Vectors that carry the entity schemas they use, a policy, and cases for `expect`,
> `scope` walks and a refused write, so the file alone is enough to run them.

---

Implemented by: [`operations.ts`](../../../packages/backend-system/conformance/src/operations.ts)
(the cases, `runOperationCase`, `describeOperations`),
[`recordOperationVectors.ts`](../../../packages/backend-system/conformance/scripts/recordOperationVectors.ts)
(recording, on the in-memory backend).
The vectors: [`vectors/operations/operations.json`](../../../packages/backend-system/conformance/vectors/operations/operations.json).
Pinned by: every backend's conformance suite, which runs the vectors —
[`portsConformance.test.ts`](../../../packages/backend-system/inmemory/tests/portsConformance.test.ts)
for the in-memory backend; refusal by the write check in
[`stagedChecks.ts`](../../../packages/backend-system/conformance/src/stagedChecks.ts).
