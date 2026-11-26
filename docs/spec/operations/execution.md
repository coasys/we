# Operations: execution

How a conforming implementation runs an operation ([Format](format.md)). The part that runs one is
called _the runner_ below; it may be the host, the backend, or a library either calls. Every rule
here applies whichever it is.

## Invocation

An operation is run by an **invocation**:

| Field          | Value                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------ |
| `operation`    | The qualified name, `<namespace>.<name>`.                                                  |
| `version`      | Optional. The version of the declaring manifest the caller wrote against.                  |
| `args`         | A JSON object of param name to value. Absent means `{}`.                                   |
| `invoker`      | The id of the agent the operation acts as. Bound as `invoker`.                             |
| `invokedAt`    | The moment of the invocation, as ISO 8601 text in UTC. Bound as `invokedAt`.               |
| `invocationId` | A string identifying this invocation. What created records' ids derive from ([Ids](#ids)). |
| `dataset`      | The dataset every step reads and writes.                                                   |

For a live call the host MUST fill `invoker` with the agent actually making the call (never a value
the caller chose), `invokedAt` with the current time, and `invocationId` with a fresh value that no
other invocation has used; a UUID is RECOMMENDED. A replay of an earlier invocation MUST supply that
invocation's original `invoker`, `invokedAt` and `invocationId`.

An operation reads no clock: `invokedAt` is the only time it knows, so a replay computes the same
values.

The runner MUST fail with static `unknownOperation` when no operation is registered under the name,
and with static `versionMismatch` when `version` is given, the namespace was registered with a
version, and the two differ.

### Args

Before any step runs, `args` is checked against the operation's `params`:

1. `args` MUST be an object; otherwise static `badArgs`.
2. A key of `args` that is not a declared param fails with static `badArgs`.
3. For each declared param, an arg that is absent or `null` is **not given**. A required param not
   given fails with static `badArgs`. An optional param not given is bound, to no value.
4. A given arg that does not fit its param's type ([Params](format.md#params)) fails with static
   `badArgs`.

## Names and scope

An expression may read only these names, and nothing else (no host state, no viewer, no clock):

- each declared param, by name;
- `invoker` and `invokedAt`;
- the `as` of every step before it in the same list of steps, or in an enclosing list;
- inside a `forEach` body, the loop's `as`, and the names bound earlier in the same iteration;
- inside a comprehension, its variable ([Comprehensions](expressions.md#comprehensions)).

A name bound inside a `forEach` body is scoped to its iteration and is not visible after the loop. A
step's own `as` is not visible in its own `when` or body. `returns` sees the names visible after the
last top-level step.

A called operation runs with its own names: its params (from the call's `args`), `invoker` and
`invokedAt` (the same as the caller's), and its own steps' names. It sees none of the caller's.

Reading a name that is not bound is caught statically ([Static checks](format.md#static-checks)); a
runner MUST also refuse it at run time, with static `unboundName`, since an operation may reach a
runner that has not run every static check.

## Running the steps

Steps run one at a time, in the order written, each one finishing before the next begins.

For each step:

1. If it has a `when` and the `when` evaluates to a falsy value, the step is **skipped**: it does
   nothing, and if it has an `as`, that name is bound to no value.
2. Otherwise the step runs as its verb says below, and if it has an `as`, its result is bound to it.

A value is evaluated when the step that holds it runs, against the names bound at that moment.
Evaluating an expression never fails, except that one that does not parse is static `malformed`
and one that reads an unbound name is static `unboundName`.

**A record as bound.** Where a step binds a record, it binds its fields as plain data (its
properties, its relations as the backend reads them, its `id`), never anything a backend uses to
represent it. An expression reads values, never methods.

**Ids from values.** Where a step takes "a value giving a record or its id" (`id`, `target`,
`parent.id`, `scope.anchorId`), the value is read as: a non-empty string is the id; an object with a
non-empty string `id` is that id; anything else fails with static `malformed` (except where a rule
below says what no value means). Where it takes a list of records or ids (`targets`, a to-many field),
each entry is read the same way.

### `find`

1. The `where` is evaluated. If a comparison in it is with no value, the find is
   [narrowed](#a-find-never-widens) rather than sent as written.
2. `limit`, when given, MUST evaluate to a whole number ≥ 0; otherwise static `malformed`.
3. With `one: true`, at most two records are read (the lower of `limit` and 2).
4. With a `scope`, `anchorId` is evaluated; no value makes the result empty. Otherwise the find reads
   the records of `entity` held under the anchor through `via`, walking by `levels` or `transitive`
   when given.
5. The read is of **committed state**: it MUST NOT see any write this operation has made. What the
   operation created or changed is reached by the names its steps bound.
6. Result: with `one: true`, exactly one record, or precondition `notFound` when none matched and
   precondition `ambiguous` when more than one did. Otherwise a list of the records, in `order` when
   given.

#### A find never widens

A comparison with no value matches nothing ([The absent-value
rule](README.md#the-absent-value-rule)), and sent to a backend as written it might be dropped and
the read widened. So the runner rewrites the evaluated where first:

- a field clause comparing with no value (directly, or as an operator's operand) matches nothing;
- no-value entries are dropped from a list of values;
- an `AND` with a branch that matches nothing matches nothing; an `OR` drops such branches, and
  matches nothing when none are left; a `NOT` of a clause that matches nothing matches nothing; a
  `some` or `none` whose clause matches nothing matches nothing;
- a where that matches nothing gives an empty result without reading.

### `create`

1. The entity is resolved ([Chosen entities](#chosen-entities)).
2. `fields` is evaluated; it MUST give an object, otherwise static `malformed`. A field whose value
   is absent is left out (absent is how a field starts). A field holding `''` or `null` is passed to
   the backend, which stores no value for it.
3. The record's id is derived: from its identity when the create declares one ([Identity
   ids](#identity-ids)), else from the step's path ([Ids](#ids)). An identity field with no value,
   or with a value that is not a string, number or boolean, fails with static `malformed`. If this
   operation already created a record under that id, the operation fails with precondition
   `recordExists`.
4. With a `parent`, `parent.id` is evaluated. No value means the record is created with no parent;
   otherwise it is created under that record, joining its `parent.relation`.
5. The record is created, in the operation's transaction. If a record with the derived id already
   exists, the operation fails with precondition `recordExists`.
6. Result: an object of the fields as evaluated in step 2, plus `id`.

### `update`

1. The entity is resolved, and `id` is evaluated to an id.
2. The record is found: a record this operation created or read earlier, else the committed record.
   None fails with precondition `notFound`.
3. `fields` is evaluated (an object, or static `malformed`); absent fields are left out; each name in
   `unset` is set to `''`.
4. The fields are written onto the record, in the operation's transaction. A to-many relation named
   in `fields` is replaced with the list given.
5. Result: no value.

### `delete`

1. The entity is resolved, and `id` is evaluated to an id.
2. If the record exists (made or read by this operation, or committed), it is deleted in the
   operation's transaction. If it does not, the step does nothing: the state asked for already holds.
   With `own`, a record that exists, that this operation did not create, and whose `author` is not
   `invoker` fails with precondition `notOwn` instead.
3. Result: no value.

### `link` and `unlink`

1. The entity is resolved; `id` and `target` are evaluated to ids; `relation` is the literal name,
   or what its expression gives, which MUST be a non-empty string (otherwise static `malformed`).
2. The relation's **membership** is what this operation has left it as: the committed members, read
   the first time the operation touches that relation of that record, with every `link`, `unlink` and
   `setRelation` the operation has made since applied over them. A record this operation created
   starts with the members its `create` gave the relation, or none. Reading the committed members of
   a record that does not exist fails with precondition `notFound`.
3. Strict `link` of a target already a member fails with precondition `alreadyLinked`; strict
   `unlink` of a target not a member, with precondition `notLinked`.
4. Lenient `link` of a member, and lenient `unlink` of a non-member, do nothing.
5. Otherwise the target is added (appended, on an ordered relation) or removed, in the operation's
   transaction.
6. Result: no value.

The backend judges the relation itself: a relation the record's entity does not declare, or a to-one
relation, is refused by the backend.

### `setRelation`

1. As `link` step 1, with `targets` evaluated to a list of ids. No value is the empty list; anything
   that is not a list of records or ids fails with static `notAList`.
2. The relation's membership becomes exactly that list, in that order, in the operation's
   transaction. With `keep`, the list is first extended by the members the relation holds (as this
   operation has left them, read from committed state the first time) that it does not name, in the
   order they held.
3. Result: no value.

### `forEach`

1. `in` is evaluated. No value is the empty list; anything else that is not a list fails with static
   `notAList`.
2. For each item, in list order: the item is bound to `as`, its **key** is computed, and the body runs
   with the names visible so far plus the item.
3. The key is: the `key` expression's value when `key` is given, else the item's `id` when it has
   one, else the item's `key`. A key MUST be a non-empty string or a finite number; a number is
   written as its shortest round-tripping decimal text (ECMAScript `Number::toString`: `1`, `1.5`,
   `1e+21`), so `1` and `"1"` are the same key. An item with no key fails with static `forEachKey`;
   two items in one loop with the same key fail with static `forEachKey`.
4. Nesting deeper than three `forEach` steps within one definition fails with static `malformed`.
5. Result: none; a `forEach` binds no name after itself.

### `check`

1. `condition` is evaluated. Truthy: the step does nothing.
2. Falsy: the operation fails with a precondition error whose code is `error` and whose message is
   the operation's `errors[error]`. An `error` the operation does not declare is static `malformed`.

### `call`

1. The callee is looked up by qualified name; none is static `unknownOperation`.
2. `args` is evaluated (no value is `{}`) and checked against the callee's params as in
   [Args](#args).
3. The callee's steps run within this operation's transaction, with its own names, and its
   `returns` is the step's result (no value when it has none).
4. Calls nested more than 16 deep fail with static `callDepth`. (A validated manifest has an acyclic
   call graph; the bound is a guard for one that was not validated.)

The callee's created records take ids under the call's path ([Ids](#ids)). A precondition error
raised in the callee, including a `check` with one of the callee's own `errors`, fails the whole
operation.

### Chosen entities

A write's entity is its literal `entity`, or the value of its expression, which MUST be a string
admitted by an entry of `oneOf`:

- an entity name admits exactly that name;
- `{ "category": "blockable" }` admits an entity in that category among the entities registered
  **when the step runs**;
- `{ "category": "any" }` admits any entity the dataset can read and write, except one a registered
  manifest declares abstract.

A value no entry admits fails with static `outsideOneOf`. Either way, an entity that is
access-control fails with static `protectedEntity`, and one the dataset has no record type for fails
with static `unknownEntity`.

**The host judges a chosen entity per call.** A host that decides permission from the effect summary
([Permission and confirmation](#permission-and-confirmation)) cannot know, before the operation
runs, which entity a chosen entity will be. So the invocation MAY carry the host's judgement of a
chosen entity: once the entity is resolved and admitted above, and before the step writes, the
runner asks it with the entity's name, and when it refuses, the operation fails with static
`notGranted` and nothing it wrote lands. A host that gates operations by permission MUST pass one
for every invocation it gates, and it MUST answer from the same table it uses for the summary, for
the entity actually chosen. The judgement is the host's; nothing in the invocation's `args` can
supply or widen it.

### Returns

After the last step (and after every `expect` re-read), `returns`, when present, is evaluated and is
the operation's result. Without `returns` the result is no value.

## `expect`

Every `find` with `expect: true` that ran records the ids it read. After the last step, and before
commit, each is read again with the same query, inside the transaction. If the set of ids differs
from the set first read, the operation fails with precondition `expectChanged`. Ids are compared as
a set; order does not matter.

> **Planned.** A conditional commit: the backend commits only if no `expect` find's answer has
> changed, atomically with the commit. A backend that can only re-read before commit, as the
> reference runner does, leaves a window between the re-read and the commit, and MUST list that as a
> capability gap in its conformance results.

## Ids

A record an operation creates has an id derived from the invocation and the step that creates it,
so the same invocation run again names the same records (and is refused as `recordExists` rather
than duplicating them), and every implementation arrives at the same ids.

**The step path** is a list of text segments, built from the operation's top-level steps down to
the creating step:

- each step contributes its index in its list of steps, in decimal: `0`, `1`, …;
- each `forEach` it sits inside contributes, after its own index, `k=` followed by the current item's
  key: `k=todo`;
- each `call` it sits inside contributes, after its own index, `c=` followed by the called
  operation's qualified name: `c=core.thread`. The callee's steps then continue the path from there.

The operation's own name is not part of the path. A forEach contributes the item's key, never its
position, so reordering a list does not change which id each item's record gets.

**The derivation:**

1. Take the list `[invocationId, ...path]`.
2. Write each element as the decimal number of bytes in its UTF-8 encoding, then `:`, then the
   element itself. Concatenate, and encode the result as UTF-8.
3. Hash those bytes with SHA-256.
4. Take the first 16 bytes. Set the version: byte 6 = (byte 6 AND `0x0f`) OR `0x80`. Set the
   variant: byte 8 = (byte 8 AND `0x3f`) OR `0x80`. This is a version-8 UUID ([RFC 9562
   §5.8](https://www.rfc-editor.org/rfc/rfc9562#section-5.8)).
5. Format the 16 bytes as lowercase hexadecimal in groups of 8, 4, 4, 4 and 12 digits separated by
   `-`, and prefix `urn:uuid:`.

> **Why length prefixes.** A separator could appear inside a key; with each segment's length in
> front, no key, whatever it holds, can make two different paths encode alike.

**Examples.** These are normative test vectors.

| `invocationId`                         | path               | bytes hashed (as text)                                  | id                                              |
| -------------------------------------- | ------------------ | ------------------------------------------------------- | ----------------------------------------------- |
| `00000000-0000-4000-8000-000000000001` | `0`                | `36:00000000-0000-4000-8000-0000000000011:0`            | `urn:uuid:30198dab-4163-8c59-abb3-e132517aa975` |
| `00000000-0000-4000-8000-000000000001` | `1`, `k=todo`, `0` | `36:00000000-0000-4000-8000-0000000000011:16:k=todo1:0` | `urn:uuid:01b39ce5-8a65-8ff1-8585-d297b052740d` |
| `3f2b8c1e-0000-4000-8000-000000000001` | `0`, `k=todo`, `0` | `36:3f2b8c1e-0000-4000-8000-0000000000011:06:k=todo1:0` | `urn:uuid:2ddc1399-ea85-86eb-add9-4f8c93c81318` |
| `inv`                                  | `0`, `k=café`, `1` | `3:inv1:07:k=café1:1` (`é` is two bytes)                | `urn:uuid:a0a65afc-1e06-80ad-806a-67780c230bba` |

The first two are the board and its first column in the `create-and-link` vector
([Conformance](conformance.md)).

A host that needs to know a record's id before the operation runs (to show it optimistically, or to
pass it to a later write) MAY derive it the same way from the invocation id it will use.

### Identity ids

A `create` with `identity` ([Format](format.md#create)) names its record by what it is, not by who
made it: the id is the same from every invocation, so the same identity made twice, anywhere, is one
record.

1. Take the list `['', d=D, entity, field₁, value₁, field₂, value₂, …]`: the empty string; when the
   dataset has an identity domain `D` (below), `d=` followed by it, and nothing when it has none; the
   create's entity name; then each identity field in the order `identity` lists them, followed by
   its value as text: a string as it is, a number as its shortest round-tripping decimal (as a
   `forEach` key is), `true` or `false`.
2. Continue from step 2 of the derivation above: frame each element, hash, and format the UUID.

**Why an empty first element.** It sets identities apart from invocations. An invocation id is a
non-empty string, so the framing of an identity begins `0:` and no invocation's framing ever does:
the two kinds of id are derived from inputs that can never be equal, and so never collide short of
SHA-256 colliding. A runner MUST refuse an empty `invocationId` (static `malformed`).

**The dataset's identity domain.** A dataset that stands for one thing (a space) holds a record
naming that thing (the space's own `Space` record). Its id is the dataset's **identity domain**: the
record is written first, before anything else in the dataset, reaches every agent that holds the
dataset, and never changes. A dataset that names nothing (a personal one, one the host keeps for its
own configuration) has no domain. The host says which record names a dataset; the runner takes the
domain from the invocation's dataset, it is not an argument, and no expression reads it. With it,
an identity names a record within that space and nowhere else: two spaces' `done` are two records,
as they are two things, while every agent holding one space derives the same id for its `done`. A
dataset without a domain keeps the shorter framing, and the same identity in two such datasets gives
the same id in each, which the data model allows (ids are unique within a dataset).

> **Why the record, not the address the dataset is shared at.** A space's vocabulary (its task
> states, its roles) is written when the space is made, before it is shared, and an address exists
> only once it is. Ids derived within the address would differ from the ones the vocabulary was
> seeded with, so the same slug made after sharing would name a second record. The space's own
> record exists before the vocabulary and is the same on every agent, shared or not.

> **Why the two never collide.** Without a domain the list has an even number of elements (the
> empty string, the entity, then a field and a value per field); with one it has an odd number. The
> framing is length-prefixed, so two lists hash alike only when they are equal, and lists of
> different lengths never are. `d=` marks the element for whoever reads the bytes; nothing depends
> on it.

**Examples.** Normative test vectors.

| entity      | identity                                              | domain                | bytes hashed (as text)                                    | id                                              |
| ----------- | ----------------------------------------------------- | --------------------- | --------------------------------------------------------- | ----------------------------------------------- |
| `TaskState` | `slug` = `blocked`                                    | none                  | `0:9:TaskState4:slug7:blocked`                            | `urn:uuid:843d442c-0a43-850e-8a67-3a96966e5c49` |
| `TaskState` | `slug` = `blocked`                                    | `urn:example:space-a` | `0:21:d=urn:example:space-a9:TaskState4:slug7:blocked`    | `urn:uuid:1dc050ca-60a7-8861-aab2-e1cb9e0ee03f` |
| `TaskState` | `slug` = `blocked`                                    | `urn:example:space-b` | `0:21:d=urn:example:space-b9:TaskState4:slug7:blocked`    | `urn:uuid:ea99375c-b545-886d-b300-15865134e59d` |
| `Role`      | `slug` = `admin`                                      | none                  | `0:4:Role4:slug5:admin`                                   | `urn:uuid:86c6ab81-f4a4-8f85-997b-e64cde1d859e` |
| `Vote`      | `poll` = `urn:example:p`, `voter` = `did:example:ann` | none                  | `0:4:Vote4:poll13:urn:example:p5:voter15:did:example:ann` | `urn:uuid:6ce7df0a-6f09-8bff-a03e-b41f62804a81` |
| `Seat`      | `row` = `café`, `n` = `1.5`                           | none                  | `0:4:Seat3:row5:café1:n3:1.5` (`é` is two bytes)          | `urn:uuid:88084a04-6308-804b-8623-9ce69f883852` |

The first is the state in the `identity-id` vector and the second the one in `identity-id-in-space`
([Conformance](conformance.md)); every row is a case of the [id vectors](conformance.md#the-id-vectors).

## Atomicity

**Definition.** An operation is atomic when:

1. if it succeeds, all of its writes become visible to this replica's readers together, as one
   change, and anything watching the dataset is told of them once, after they land;
2. if it fails, at any step and for any reason, none of its writes become visible, and the error
   reaches the caller;
3. nothing it writes is sent to any other replica until the local commit has succeeded.

A backend SHOULD run operations atomically. A backend that cannot meet any part of the definition
MUST say which part, as a known gap in its conformance results, and MUST still run every write
through the write check.

Preconditions (`find` with `one`, `check`, strict `link`/`unlink`, `expect`) hold **on this replica,
at the time they are evaluated** (or, for `expect`, at commit). They are not serialisable across
agents: two agents on two replicas can each pass a check that their writes together break. An
operation that needs a guarantee across agents cannot get it from this version of the format.

> **Why.** "All or nothing, here" is what every backend can promise, and is what a person pressing a
> button needs; agreement across replicas is a property of the network beneath, not of the
> operation.

## Serial

An invocation whose operation declares [`serial`](format.md#serial) has a queue key: the expression
evaluated over the checked args, with only the params bound. A host that starts runs SHOULD start an
invocation only once every earlier invocation it started with the same key in the same dataset has
finished, whether that one succeeded or failed. Invocations with different keys, or none, are not
ordered by this. An invocation whose args fail the [args check](#args) has no key; its run fails
anyway.

The key orders the runs one host starts. It says nothing about another agent's runs, which
[Atomicity](#atomicity)'s rule on preconditions still covers.

Implemented by: [`run.ts`](../../../packages/entities/src/operations/run.ts) (`serialKey`),
[`invokeOperation.ts`](../../../packages/app-shell/src/shared/invokeOperation.ts) (the queue).
Pinned by: [`entities/tests/operations.test.ts`](../../../packages/entities/tests/operations.test.ts)
("a serial key"), [`app-shell/tests/invokeOperation.test.ts`](../../../packages/app-shell/tests/invokeOperation.test.ts),
[`app-shell/tests/involvements.test.ts`](../../../packages/app-shell/tests/involvements.test.ts)
("writes quick presses in order").

## Running speculatively

_This section is informative: it says what a host MAY do, and nothing here changes what an
operation means._

A person who presses something watches for it to happen, and the write behind the press comes back
through the backend's own notifications a round trip later. A host MAY draw an operation's writes
before they land by running it twice with **one invocation**: first speculatively, then for real.

- **The speculative run** is the same runner over a view of the dataset that answers each `find`
  from what the host currently sees — the committed records, with the host's own pending predictions
  laid over them — and records each write instead of making it. It asks the [write check](#the-write-check)
  as the real run will. What it recorded is the **prediction**.
- **The real run** is the invocation as this spec describes it, with the same `invocationId` and
  `invokedAt`.

Because a created record's id derives from the invocation and the step ([Ids](#ids)), and an
identity id from the entity and the identity, the records the prediction draws have exactly the ids
the real run gives them. Reconciling is therefore a matter of ids, not of resemblance:

1. A speculative run that fails, statically or on a precondition (a refusal included), predicts
   nothing, and nothing is drawn.
2. While the real run is going, every read the host draws MAY show the prediction laid over what it
   read: a predicted create where the read asks for its entity and its parent, a delete taken out,
   an edit or a relation change applied to the record of that id.
3. When the real run fails, the prediction is withdrawn.
4. When it succeeds, each read keeps the prediction until that read's answer has moved: its records
   now say what was predicted (the real rows have arrived), or say something else than they did
   when the run returned (another agent's write landed, and the real rows win). A backstop retires
   a prediction no read ever answers.
5. Predictions are about a dataset, and a host drops them when it stops showing that dataset.

A speculative run's reads see the predictions still pending from earlier invocations, but not its
own writes, as the real run's reads do not: a second press made before the first has landed is
predicted from the first one's answer. Invocations sharing a [serial](#serial) key are predicted
in the order they were made.

Nothing here is part of an operation's result. A host that never runs speculatively conforms, and a
backend that delivers writes at once makes a prediction retire on its first read.

Implemented by: [`speculate.ts`](../../../packages/entities/src/operations/speculate.ts)
(`speculateOperation`), [`predictions/`](../../../packages/entities/src/predictions/index.ts) (what is
drawn, and when it stops),
[`invokeOperation.ts`](../../../packages/app-shell/src/shared/invokeOperation.ts) (the host's one way
to run an operation).
Pinned by: [`backend-inmemory/tests/speculativeRun.test.ts`](../../../packages/backend-system/inmemory/tests/speculativeRun.test.ts),
[`entities/tests/predictions.test.ts`](../../../packages/entities/tests/predictions.test.ts),
[`app-shell/tests/invokeOperation.test.ts`](../../../packages/app-shell/tests/invokeOperation.test.ts).

## The write check

Every primitive write an operation makes (each create, edit, delete, relation add and remove) MUST
be judged by the backend's write check (the access policy of the dataset) exactly as the same write
made on its own would be. An operation can do nothing its invoker could not do one write at a time.
A write the check refuses fails the operation with precondition `refused`, carrying the check's
reason as its message, and (by [atomicity](#atomicity)) leaves nothing behind.

**The check sees the transaction's own staged writes.** A write to a record the operation created
earlier is judged against that staged record, with the agent who wrote it as its author; a write to a record it
edited or deleted earlier is judged against the edit or the absence. Reads (`find`) do not see staged
writes; the check does.

**The check is the backend's to answer.** The record a check judges MUST come from the backend's own
view of committed and staged state. A runner MUST NOT be able to hand the check a record, or tell it
what a record holds.

> **Why.** A runner that could say what the record holds could say whatever lets the write through:
> it would be a way round every rule in the policy.

## Protected entities

An implementation's access-control records (the ones its write check reads to decide who may write
what) MUST NOT be written by any operation. A write naming one, literally or through a chosen
entity, fails with static `protectedEntity`, and a manifest whose operations name one literally in a
write fails its static checks. In WE these are `Policy`, `Role` and `RoleGrant`.

Because an operation cannot write them, an operation's own writes never change the policy its
writes are judged by.

## Errors

An operation that fails, fails with one error:

| Field     | Value                                                            |
| --------- | ---------------------------------------------------------------- |
| `class`   | `static` or `precondition`.                                      |
| `code`    | One of the codes below, or a name from the operation's `errors`. |
| `message` | Text for a person. Not compared between implementations.         |
| `step`    | Optional: where it happened.                                     |

**`static`**: the operation, or the call to it, is wrong. Running it again unchanged fails the same
way; the fault is in the definition or the call.

| Code               | When                                                                                                                                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `malformed`        | The definition breaks the format; an expression does not parse; a value is not the kind its field takes (an id, an object of fields, a whole-number `limit`, a relation name); a `check` names an undeclared error; `forEach` nests too deep. |
| `unknownOperation` | No operation is registered under the name invoked or called.                                                                                                                                                                                  |
| `versionMismatch`  | The invocation's `version` is not the registered one.                                                                                                                                                                                         |
| `badArgs`          | `args` is not an object, names an undeclared param, misses a required one, or holds a value of the wrong type.                                                                                                                                |
| `unboundName`      | An expression reads a name not bound where it sits.                                                                                                                                                                                           |
| `unknownEntity`    | The dataset has no record type for an entity a step names.                                                                                                                                                                                    |
| `outsideOneOf`     | A chosen entity's value is not admitted by its `oneOf`.                                                                                                                                                                                       |
| `notGranted`       | The host refused the entity a chosen entity resolved to, for this caller ([Chosen entities](#chosen-entities)).                                                                                                                               |
| `protectedEntity`  | A write names an access-control entity.                                                                                                                                                                                                       |
| `forEachKey`       | A `forEach` item has no key, or two items share one.                                                                                                                                                                                          |
| `notAList`         | A `forEach`'s `in` or a `setRelation`'s `targets` is not a list.                                                                                                                                                                              |
| `callDepth`        | Calls nest more than 16 deep.                                                                                                                                                                                                                 |

**`precondition`**: the data was not as the operation requires. Running it again later may succeed.

| Code              | When                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `notFound`        | A `find` with `one` matched nothing; an `update`, `link` or `unlink` named a record that is not there. |
| `ambiguous`       | A `find` with `one` matched more than one record.                                                      |
| `alreadyLinked`   | A strict `link`'s target is already a member.                                                          |
| `notLinked`       | A strict `unlink`'s target is not a member.                                                            |
| `notOwn`          | A `delete` with `own` named a record somebody other than the invoker made.                             |
| `recordExists`    | A `create`'s derived id is already held: most often a replay, or the same identity made again.         |
| `expectChanged`   | An `expect` find's answer changed before commit.                                                       |
| `refused`         | The write check refused a write.                                                                       |
| _a declared name_ | A `check` failed with one of the operation's (or a callee's) `errors`.                                 |

A failure that is neither (the backend unreachable, storage failing) is not an operation error and
MAY be reported however the implementation reports such faults; the atomicity rules still apply.

A declared name's `message` is the operation's own, written for the person who asked; a host MAY
show it to them as it is. Every other code's message is for whoever wrote the definition or the
call, and a host SHOULD say the failure in its own words instead. A `refused` error is the write
check's to explain, and a host that already said so SHOULD NOT say it again.

`step` SHOULD be a path naming the step: `<namespace>.<name>/steps.<index>.<verb>`, with
`[<key>].steps.<index>.<verb>` for each `forEach` level and `/steps.<index>.<verb>` after a `call`,
for example `core.makeBoard/steps.1.forEach[todo].steps.0.create`. Its exact form is not compared.

## The effect summary

What an operation may write, worked out from its definition without running it. An implementation
that offers operations to people, templates or agents SHOULD compute it, and MUST compute it this way
when it uses it to decide permission or confirmation.

```json
{
  "entities": { "CollectionBlock": ["add:children", "create"] },
  "categories": { "blockable": ["create"] },
  "bulk": true,
  "destructive": false
}
```

Walk every step of the operation, through every `forEach` body and into every called operation
(each callee once per path), **ignoring `when`**: the summary says what the operation could write,
not what one run will. Record, per entity:

| Step                               | Verbs recorded                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `create`                           | `create` on its entity; with a `parent`, `add:<parent.relation>` on `parent.entity`, or on `*` when the parent names no entity. |
| `update`                           | `edit`                                                                                                                          |
| `delete`                           | `delete`; `deleteOwn` with `own`                                                                                                |
| `link`                             | `add:<relation>`                                                                                                                |
| `unlink`                           | `remove:<relation>`                                                                                                             |
| `setRelation`                      | `add:<relation>` and `remove:<relation>`; `add:<relation>` alone with `keep`                                                    |
| `find`, `check`, `forEach`, `call` | nothing themselves                                                                                                              |

- A literal `entity` records under its name. A chosen entity records under each name in its `oneOf`,
  and under each category in `oneOf` in `categories`, as the category itself, never expanded into its
  members.
- A `relation` given as an expression is recorded as `*` (`add:*`, `remove:*`).
- `bulk` is true when any write sits inside a `forEach`, directly or through a call made from one.
- `destructive` is true when any `delete` or `remove:` verb is recorded (so every `unlink`, and every
  `setRelation` without `keep`). `deleteOwn` is not destructive: the run cannot reach beyond the
  invoker's own records with it, and taking back what one gave destroys nothing of anybody else's.
- Entity and category keys, and each list of verbs, are sorted by code point.

An operation **writes** when `entities` or `categories` is non-empty. One that writes nothing (only
reads and checks) is not a write.

> **Why categories stay unexpanded.** The members of `blockable` change as modules come and go; a
> summary listing them would change too, and a consent given against it would silently cover a type
> the person never saw.

> **Why per call, not the widest.** Giving a category the widest group a caller might hold would
> make a generic write (delete these records, edit this record) need settings permission to delete
> a post, and give anyone who holds it every entity the category reaches. Judging the entity passed
> gives each call exactly what the same write made on its own would need.

### Permission and confirmation

A host deriving what invoking an operation needs MUST derive it from the effect summary, never from
anything written beside the operation:

- **Permission.** The host keeps one table mapping entities to its permission groups. Holding an
  operation at all needs the widest group any entity recorded under `entities` reaches, and an entity
  the table does not list falls in the host's default group. A category recorded under `categories`
  says "an entity chosen at call time, in this category", and adds nothing to that group: the entity
  is known only when the step runs, so the host judges it then, by the same table, for the caller
  invoking it ([Chosen entities](#chosen-entities)). So invoking an operation needs what making its
  writes one at a time would, call by call: one generic delete removes a post for a caller who may
  write content and is refused a settings record to the same caller.
- **Confirmation.** A host that confirms destructive actions MUST treat an operation as destructive
  exactly when `destructive` is true, and SHOULD describe it to the person from the summary ("creates
  a board; adds to board's children; may write many records in one call").

> **Planned.** Write scope and consent for operations from sources a person does not trust: a
> bundle's operations limited to its own entities plus ones it lists, and the install and update
> screens showing each operation's effect summary for consent. Until then an operation is bounded by
> its invoker's policy and the permission group its writes reach.

---

Implemented by: [`run.ts`](../../../packages/entities/src/operations/run.ts) (`runOperation`),
[`ids.ts`](../../../packages/entities/src/operations/ids.ts) (`deriveRecordId`),
[`errors.ts`](../../../packages/entities/src/operations/errors.ts),
[`effects.ts`](../../../packages/entities/src/operations/effects.ts) (`effectSummary`),
[`catalog.ts`](../../../packages/entities/src/operations/catalog.ts) (`describeEffects`),
[`registry.ts`](../../../packages/entities/src/operations/registry.ts),
[`entityRegistry.ts`](../../../packages/entities/src/entityRegistry.ts) (`runEntityTransaction`,
the write check), [`operationGroups.ts`](../../../packages/app-shell/src/shared/registries/operationGroups.ts)
(WE's permission table).
Pinned by: [`inmemory/tests/operations.test.ts`](../../../packages/backend-system/inmemory/tests/operations.test.ts)
("running an operation", "ids", "static errors at run time", "the write check, against what the
operation has staged"), [`entities/tests/operations.test.ts`](../../../packages/entities/tests/operations.test.ts)
("record ids", "the effect summary"), the conformance cases in
[`writes.ts`](../../../packages/backend-system/conformance/src/writes.ts),
[`sameBatch.ts`](../../../packages/backend-system/conformance/src/sameBatch.ts),
[`stagedChecks.ts`](../../../packages/backend-system/conformance/src/stagedChecks.ts) and the
[operations vectors](conformance.md).
