# Operations: conformance

The operations suite is a set of **vectors**: language-neutral JSON cases, each an operation, the
records a dataset starts with, an invocation, and what a conforming implementation produces from
them, the outcome and the records the dataset ends with. Another implementation runs every vector
and compares; it conforms when every vector matches.

The vectors are authoritative where this prose and they disagree ([Conventions](../README.md#conventions)).
They were recorded on the reference implementation and are re-recorded only on purpose, so a change
to one is a change to the contract.

**A vector is only as right as the review it had.** Being recorded from the reference, it carries
whatever the reference got wrong. So an implementation that disagrees with a vector opens a question
about the spec, and the vector is not re-recorded to match either side until that question is
answered: what the spec says the case should produce, and which implementation, if either, does. Until
then the disagreeing implementation lists the case as a known gap, saying what it produces, as for any
other gap.

Beside them, five suites need no backend: the [core-subset expression
vectors](#the-core-subset-expression-vectors), the [static checks](#the-static-check-vectors), the
[effect summary](#the-effect-summary-vectors), the [id derivation](#the-id-vectors) and the [RDF
reading](#the-rdf-vectors). A conforming implementation passes all six.

## The file

The operations vectors are one JSON file:

```json
{ "version": 2, "entities": { … }, "protectedEntities": [ … ], "policy": { … }, "cases": [ … ] }
```

`version` is the vector file's own format version. What every case shares:

| Key                 | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entities`          | The entity schemas the cases run against, in the [data model](README.md#the-data-model): every entity a case seeds, observes or names in a step (its own operations' and the ones they call), and every entity a relation of those targets. Each is `{ "properties", "relations", "abstract"?, "blockable"? }`, inheritance already applied; a property is `{ "type", "required"?, "default"? }` and a relation `{ "target", "cardinality", "ordered"?, "reverseOf"? }` (an empty `target` is untyped). The dataset has these record types and no others. |
| `protectedEntities` | The access-control entities ([Protected entities](execution.md#protected-entities)). Each is in `entities`.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `policy`            | The write check every case runs under ([below](#the-write-check)): `{ "rules", "invoker": { "member", "roles" } }`.                                                                                                                                                                                                                                                                                                                                                                                                                                       |

Each case:

| Key            | Value                                                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | The case's name, unique in the file.                                                                                                                                                                                |
| `note`         | One sentence saying what the case shows.                                                                                                                                                                            |
| `manifest`     | `{ "version", "operations" }`: the case's operation and any of the suite's that it calls. Register its `operations` under the namespace `conformance`, with the file's `entities` as its entities.                  |
| `calls`        | An object of qualified name to operation definition: every operation of WE's that the case's operations call, at any depth. Register each under the namespace its name gives (`core.thread` as `thread` in `core`). |
| `dataset`      | The records the dataset starts with: a list of `{ "entity", "id", "fields", "relations"? }`.                                                                                                                        |
| `operation`    | The bare name of the operation to run; it runs as `conformance.<operation>`.                                                                                                                                        |
| `args`         | The invocation's `args`.                                                                                                                                                                                            |
| `invoker`      | The invocation's `invoker`: `did:example:invoker`, or another name for a case about a record somebody else made ([below](#running-a-vector)).                                                                       |
| `invocationId` | The invocation's `invocationId`.                                                                                                                                                                                    |
| `invokedAt`    | The invocation's `invokedAt`.                                                                                                                                                                                       |
| `concurrent`   | Optional. Records another writer commits while the operation runs, in the shape of `dataset`'s ([Running a vector](#running-a-vector), step 3).                                                                     |
| `domain`       | Optional. The dataset's identity domain ([Identity ids](execution.md#identity-ids)), or `{ "arriving": true }` for one whose domain has not arrived. Absent: the dataset has none.                                  |
| `version`      | Optional. The invocation's `version`. Absent: none is passed.                                                                                                                                                       |
| `deniedChosen` | Optional. Entities the host refuses this caller when a step chooses them at call time ([Chosen entities](execution.md#chosen-entities)). Absent: every entity the `oneOf` admits is written.                        |
| `observe`      | What to read back afterwards: a list of `{ "entity", "fields", "relations" }`. `fields` may name `author`.                                                                                                          |
| `outcome`      | `{ "result": … }` when the operation succeeds, or `{ "error": { "class", "code" } }` when it fails.                                                                                                                 |
| `records`      | What the reads in `observe` produce: an object of entity name to a list of observed records.                                                                                                                        |

## Running a vector

For each case, on a fresh, empty dataset holding the file's `entities`:

**The invoker.** The runner runs each case as one agent of its own, which plays the invoker: wherever
the file names the invoker (in `args`, `dataset` and `concurrent`), the runner puts its agent's id,
and wherever that id comes back (in the outcome and the records observed), it reads it as the
invoker's name. The agent writes the seed records, so they are the invoker's, and the operation is
invoked as that agent, so what it creates is the invoker's too ([Invocation](execution.md#invocation):
the invoker is the agent making the call).

A case whose `invoker` is another name (`did:example:visitor`) is about what may be done to a record
somebody else made: the seeds are still written by the runner's agent, as `did:example:invoker`'s,
and the operation is invoked with `invoker` set to that other name as it is written. Such a case
fails before it writes anything, so the runner's agent remains the only writer.

1. **Seed.** As that agent, and with no write check, create every record in `dataset`, with the `id`
   given and its `fields`. Then, once all exist, set each record's `relations`: each key a to-many
   relation, its value the members' ids in order. Seeding is not part of the operation and is not
   judged by anything the case observes.
2. **Register.** Register `manifest.operations` under `conformance`, at `manifest.version`, and each
   entry of `calls` under its own namespace.
3. **Invoke** `conformance.<operation>` with `args`, `invoker`, `invocationId`, `invokedAt` and the
   dataset, under the file's policy. The dataset's identity domain is `domain`, and it has none when the
   case gives none. Pass `version` only when the case gives one. When the case has `deniedChosen`,
   the host refuses each entity it lists when a step chooses it (static `notGranted`). When the case has `concurrent`, commit those
   records outside the operation's transaction, as another writer, once the operation's first
   `expect` find has read and before the operation re-reads it.
4. **Outcome.** If the operation succeeds, its result is `{ "result": r }`, with `r` the
   operation's `returns` value and `null` when it returns no value. If it fails with an operation
   error, the outcome is `{ "error": { "class": …, "code": … } }`. Messages and `step` are not
   compared. Any other failure fails the case.
5. **Observe.** Whatever the outcome, for each entry of `observe`, read every record of `entity` in
   the dataset, and for each produce an object holding:
   - `id`;
   - each field in `fields` that has a value (absent, `null` and `''` are left out), `author`
     included;
   - each to-many relation in `relations` that has members, as the list of its members' ids: in the
     order the backend reads them when the schema in `entities` says the relation is `ordered`, and
     sorted by code point when it does not, since a set has no order to compare (a relation with none
     is left out);
   - each to-one relation in `relations` that has a value, as the record reads it without `include`:
     the one id ([Relation](README.md#the-data-model)), so a backend holding it any other way fails
     the comparison.

   Under `records[entity]`, list these sorted by `id`, by code point.

6. **Compare** the outcome with `outcome` and the observations with `records`, as JSON values: equal
   keys, equal values, lists in the same order.

**Ids are compared exactly.** A record the operation creates has an id derived from the invocation
([Ids](execution.md#ids)), so every implementation arrives at the same one, and a `result` naming a
created record names the same id. An id that differs is a failure of the derivation, not a detail.

**Code-point order** compares two strings by their Unicode code points, one at a time, a shorter
string first when it is a prefix of the other: `urn:example:Zed` sorts before `urn:example:alpha`.
Not a locale's collation.

**What is not compared.** When a record was written (`createdAt`, `updatedAt`) is each backend's to
stamp, so no case observes it. Error messages and `step` paths are each implementation's.

### The write check

Every case runs under the file's `policy`, a policy in WE's own format, judged as a host judges it on
every write ([The write check](execution.md#the-write-check)). `rules.permissions` is a list of
`{ "action", "by" }`; a write is allowed when a permission governing its action has a `by` that
reaches the writer.

- A write's action is `<Entity>.create`, `<Entity>.edit` or `<Entity>.delete`, or
  `<Entity>.<relation>.add` / `.remove` for a relation write.
- A permission naming the action exactly is the only kind that governs it. When none does, the
  wildcards do: `*` covers every action except the access-control entities'.
- `anyone` reaches every writer; `author` reaches the author of the record written, which for a
  create is the writer, and for a record the operation made earlier is the invoker; `{ "role" }`
  reaches a holder of that role, and `policy.invoker.roles` says which the invoker holds (none).

In this file: anyone may make any write, a `CollectionBlock` may be deleted only by its author, and a
`TagBlock` made only by a curator. A write refused fails the operation with precondition `refused`,
and nothing it wrote lands.

## The cases

**The runner's own rules**, over a few small operations written for the suite:

| Case                | What it shows                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `create-and-link`   | Creates and links in a `forEach`; the ids the derivation gives for a board and its columns.              |
| `forEach-keys`      | The same invocation with the list reordered: every record gets the id it got before.                     |
| `upsert-existing`   | A `find` that matches skips a `when`-guarded `create`; `returns` gives what was found.                   |
| `upsert-missing`    | A `find` that matches nothing lets the guarded `create` run; `returns` gives what was made.              |
| `found-carries-id`  | A found record carries its `id`: a step reads it by name, and a `forEach` over found records keys by it. |
| `rollback-on-check` | A failed `check` fails with its named precondition error, and the record made before it does not land.   |
| `second-write`      | An `update` of a record created earlier in the same operation lands on it.                               |
| `strict-link`       | A strict `link` of a member fails as `alreadyLinked` and changes nothing.                                |

**WE's own operations**, run under the suite's namespace, for the shapes a community's data is
mostly made of:

| Case                           | Operation           | What it shows                                                                                                |
| ------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `core-upsert-signal`           | `upsertSignal`      | With no reaction yet, makes one under the record and answers with its id.                                    |
| `core-respond-replaces`        | `respond`           | Removes the invoker's earlier answer on this record only, and makes the new one.                             |
| `core-set-involvement-to-one`  | `setInvolvement`    | Finds the pair on this record by its to-one in a `where`, and writes the new record's `node` as one id.      |
| `core-create-post-reply`       | `createPost`        | A reply: in its subject's responses and thread, a child of nothing, its block under it. Calls `core.thread`. |
| `core-move-card`               | `moveCard`          | A card leaves one column, joins another where dropped, and takes the bound column's state.                   |
| `core-remove-board-column`     | `removeBoardColumn` | A column's cards go to the board, and the column is deleted, never a card.                                   |
| `core-place-card`              | `placeCard`         | Edits the placement a canvas draws, removes the duplicate it outranks, answers with what it held.            |
| `core-create-task-state-taken` | `createTaskState`   | Refuses a name whose slug a retired state still holds (`slugTaken`), and writes nothing.                     |
| `core-mark-read-heals`         | `markRead`          | Moves the oldest read marker to `invokedAt` and removes a doubled one.                                       |
| `core-delete-records-any`      | `deleteRecords`     | Deletes records of two entities chosen at run time through `{ "category": "any" }`, and leaves the rest.     |
| `core-move-under`              | `moveUnder`         | Moves a record between holders through a relation named at run time.                                         |

**The rules the cases above leave open**, over more of the suite's own operations:

| Case                           | What it shows                                                                                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expect-holds`                 | An `expect` find that reads the same at the end lets the operation land.                                                                                               |
| `expect-changed`               | A record another writer commits after the `expect` find read fails the operation as `expectChanged`; nothing lands.                                                    |
| `find-scope-levels`            | A `scope` walk with `levels: [10, 10]` reaches children and grandchildren and stops; the anchor is not in it; `order` sorts across depths.                             |
| `find-scope-transitive`        | A `transitive` walk reaches everything under the anchor.                                                                                                               |
| `not-absent`                   | `NOT` over a comparison matches a record with no value for the field.                                                                                                  |
| `refused-write`                | A write the policy refuses fails as `refused`, and the record made before it does not land.                                                                            |
| `author-deletes-own`           | A record the operation made is the invoker's, so an author-only delete of it is allowed.                                                                               |
| `call-derived-id`              | A record made inside a `call` takes its id from the call's path (`0`, `c=conformance.note`, `0`); its author is the invoker.                                           |
| `when-false-create`            | A create whose `when` is false writes nothing, and its `as` reads as no value afterwards.                                                                              |
| `forEach-replay`               | `create-and-link` replayed onto a dataset holding its done column: the same id for that key, refused as `recordExists`, nothing added.                                 |
| `create-onto-held-id`          | A derived id a record of another entity already holds is refused as `recordExists`.                                                                                    |
| `protected-entity`             | A write to an access-control entity chosen at run time fails as static `protectedEntity`; nothing lands.                                                               |
| `relation-order`               | Four links written in the reverse of code-point order: an ordered relation keeps that order, an unordered one compares as a set, and records list in code-point order. |
| `identity-id`                  | A create keyed by `identity` takes its id from the entity and the slug, not the invocation.                                                                            |
| `identity-id-other-invocation` | Another invocation naming the same identity gets the same id as `identity-id`.                                                                                         |
| `identity-id-in-space`         | In a dataset with an identity domain (a space), the same identity gets another id, derived within it.                                                                  |
| `identity-space-not-ready`     | In a dataset whose identity domain has not arrived, an identity create fails as `spaceNotReady`; nothing lands.                                                        |
| `identity-twice`               | A second create of the same identity is refused as `recordExists`; nothing lands.                                                                                      |
| `identity-not-invocation`      | A record keyed by identity and one keyed by the invocation get different ids.                                                                                          |

**Every error code**, one case each where the cases above do not already end in it:

| Case                 | What it shows                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `update-missing`     | An `update` of a record that is not there fails as `notFound`.                           |
| `find-one-ambiguous` | A `find` with `one` that matches two records fails as `ambiguous`.                       |
| `strict-unlink`      | A strict `unlink` of a record that is not a member fails as `notLinked`.                 |
| `bad-args`           | Args missing a required param fail as `badArgs`.                                         |
| `unbound-name`       | An expression reading a name nothing binds fails as `unboundName` when it runs.          |
| `unknown-entity`     | A create of an entity the dataset has no type for fails as `unknownEntity`.              |
| `outside-one-of`     | A chosen entity its `oneOf` does not admit fails as `outsideOneOf`; nothing lands.       |
| `not-granted`        | A chosen entity the host refuses this caller fails as `notGranted`; nothing lands.       |
| `forEach-no-key`     | A `forEach` item with no key fails as `forEachKey`.                                      |
| `not-a-list`         | A `forEach` over a value that is not a list fails as `notAList`.                         |
| `call-depth`         | Calls nested seventeen deep fail as `callDepth`; the record at the bottom does not land. |
| `malformed-limit`    | A `limit` that is not a whole number fails as `malformed`.                               |
| `unknown-operation`  | A `call` to an operation nobody registered fails as `unknownOperation`.                  |
| `version-mismatch`   | An invocation for another version of the namespace fails as `versionMismatch`.           |

## The core-subset expression vectors

An operation's expressions are the core subset ([Expressions](expressions.md)), which the template
format's expression language contains. Its vectors are the template suite's, in
[`expressions.json`](../../../packages/schema-system/conformance/vectors/expressions.json) and
[`functions.json`](../../../packages/schema-system/conformance/vectors/functions.json), and every case
there says whether it is core: `"core": true` is a case an operations-only host MUST pass, and
`"core": false` one only a template host runs.

A case is core when it is a case of the grammar, of evaluation or of the printer (`op.*`, `eval.*`,
`print.*`), over no env or an env of plain names (one with only `context`), and calls only core
functions; in `functions.json`, a case of a core function with no form `context`. To run a core
expression case, bind each name of the env's `context` to its value, read every other name as no
value, evaluate `source`, and compare with `result` (or, for a case with `error: "syntax"`, refuse it
as not parsing); `print` is the template suite's and MAY be skipped. To run a core function case, call
`fn` with `args` and compare with `result`. A value `{ "$undefined": true }` is no value.

## The static-check vectors

[`static-checks.json`](../../../packages/backend-system/conformance/vectors/operations/static-checks.json)
holds manifests to refuse ([Static checks](format.md#static-checks)):

```json
{ "version": 1, "namespace": "conformance", "protectedEntities": [ … ], "entities": { … }, "cases": [ … ] }
```

Each case is `{ "id", "check", "note", "operations", "refused", "paths" }`. `check` is the number of
the check it shows in the spec's list (`0` for a case that passes them all). Register `operations`,
with the file's `entities` and under its `namespace`, as one manifest: an implementation conforms when
it refuses every case whose `refused` is true and accepts every other. `paths` are the places the
reference reports, sorted by code point; an implementation SHOULD report the same. A manifest broken
in its structure (check 1) is reported for its structure alone, before the other checks look at it.

## The effect-summary vectors

[`effects.json`](../../../packages/backend-system/conformance/vectors/operations/effects.json) holds
definitions and what they may write ([The effect summary](execution.md#the-effect-summary)):

```json
{ "version": 1, "groups": { "default", "width", "entities" }, "cases": [ … ] }
```

Each case is `{ "id", "note", "operation", "calls"?, "summary", "permission" }`. Compute the summary
of `operation`, resolving a `call` from `calls` and from WE's core operations, and compare with
`summary`. `permission` is what invoking it needs under one host's table, `groups` (WE's): `group` is
the widest group, in the order `width` lists them, that an entity under `summary.entities` reaches (an
entity the table does not list is in `default`); `chosen` lists the categories under
`summary.categories`, each an entity chosen at call time and judged then ([Permission and
confirmation](execution.md#permission-and-confirmation)), never part of `group`; `destructive` is the
summary's; `writes` is whether the operation writes at all. Every core operation has a case
(`effects.core-*`).

## The id vectors

[`ids.json`](../../../packages/backend-system/conformance/vectors/operations/ids.json) holds the id
derivation on its own ([Ids](execution.md#ids)). Each case is an invocation's,
`{ "kind": "invocation", "invocationId", "path" }`, or an identity's,
`{ "kind": "identity", "entity", "identity", "domain"? }` with `identity` a list of
`[field, value as text]`, and carries `framed`, the text hashed (as its UTF-8 bytes), and `result`,
the id. Derive the id and compare; `framed` says whether a disagreement is in the framing or after it.

## The RDF vectors

[`rdf.json`](../../../packages/backend-system/conformance/vectors/operations/rdf.json) holds the RDF
reading ([RDF reading](rdf.md)). Each case is `{ "id", "note", "document", "nquads", "summaries" }`:
`document` is a manifest's `version` and `operations`; `nquads` its triples under the
[context](context.jsonld), canonical N-Quads sorted; `summaries`, per operation, the triples of its
effect summary with the operation named `conformance.<name>`. Read `document` and compare with
`nquads`, read `nquads` back and compare with `document` as JSON values, and build each summary's
graph and compare.

## Coverage

The suite covers the spec, and a test holds it to that: every verb runs in some operations vector,
every error code in [Errors](execution.md#errors) is some vector's outcome, every static check has a
refused static-check vector, and every core function and every comprehension has a core-subset case.

## What a vector does not carry

A vector is meant to run without reading the reference implementation's source. What it still
leaves to the reader in this version:

- **The policy format beyond what the file uses.** The file's policy uses `anyone`, `author` and one
  role, and the rules above are all a runner needs for it. WE's policy format has more (members,
  `except`, conditions on a record's fields) that no case exercises.
- **Which records a `levels` walk keeps when it must drop some.** The walk case stays inside its
  bounds, because the format does not say which members a per-level limit keeps.

---

Implemented by: [`operations.ts`](../../../packages/backend-system/conformance/src/operations.ts)
(the cases, `runVector`, `describeOperations`),
[`recordOperationVectors.ts`](../../../packages/backend-system/conformance/scripts/recordOperationVectors.ts)
(recording, on the in-memory backend).
[`suites/`](../../../packages/backend-system/conformance/src/suites) (the static-check, effect, id
and RDF cases, and what records them).
The vectors: [`vectors/operations/`](../../../packages/backend-system/conformance/vectors/operations),
and the core-subset cases of the template suite's
[`expressions.json`](../../../packages/schema-system/conformance/vectors/expressions.json) and
[`functions.json`](../../../packages/schema-system/conformance/vectors/functions.json).
Pinned by: every backend's conformance suite, which runs the vectors —
[`portsConformance.test.ts`](../../../packages/backend-system/inmemory/tests/portsConformance.test.ts)
for the in-memory backend, and
[`operationVectors.test.ts`](../../../packages/backend-system/inmemory/tests/operationVectors.test.ts),
which runs every vector on a backend built from the file's `entities` alone, with only each
vector's `calls` registered.
[`operationSuites.test.ts`](../../../packages/backend-system/conformance/tests/operationSuites.test.ts)
(every static-check, effect, id and RDF vector run from its file, and every core operation read back
from its triples, e.g. `static.identity`, `effects.per-call-any`, `ids.identity-in-space`,
`rdf.make-board`), [`operationsCoverage.test.ts`](../../../packages/backend-system/conformance/tests/operationsCoverage.test.ts)
(the coverage rule), and [`operationGroups.test.ts`](../../../packages/app-shell/tests/operationGroups.test.ts)
(WE's permission table and its reading of every effect vector).
