# Declared operations

**Spec version 1.0.** Operations format version: the declaring manifest's `version`
([Versioning](versioning.md)).

A declared operation is a named, parameterised write of several records, declared as JSON data
rather than written as code: a board and its columns, a vote that replaces the voter's last one, a
post and its blocks. It is built from a closed set of steps, computes its values with a small
expression language, and runs inside one transaction with every primitive write judged by the
backend's write check. Because the steps are closed, what an operation may write can be listed
before it runs.

This spec says what an operation is, how one runs, and what an implementation has to do so that the
same operation, run with the same invocation against the same records, writes the same records with
the same ids everywhere.

> **Why.** A compound write written as code exists only in the program that holds it: every other
> host, agent or tool that needs the same write writes it again, and nothing can say what it writes
> before it runs. Named operations with a code body (GraphQL mutations, OData actions, Lexicon
> procedures) make the name portable but not the body. Declared, the body is portable too.

## Contents

| File                          | What it specifies                                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [This file](#the-data-model)  | The data model operations write (provisional): records, entities, fields, relations and their cardinality, order, categories, and the absent-value rule. |
| [Format](format.md)           | An operation definition: names and namespaces, params, errors, values, every step and its fields, static checks.                                         |
| [Execution](execution.md)     | How an operation runs: invocation, names and scope, each step's semantics, ids, atomicity, the write check, errors, the effect summary.                  |
| [Expressions](expressions.md) | The expression subset: grammar, evaluation, the where-object, and the core function library.                                                             |
| [Versioning](versioning.md)   | Compatible and incompatible changes to an operation, and how manifests and bundles signal format.                                                        |
| [Conformance](conformance.md) | The vectors: their shape, how to run them, how results are compared, and which cases exist.                                                              |
| [RDF reading](rdf.md)         | The JSON-LD [context](context.jsonld), the triples an operation and its effect summary denote, and the way back.                                         |

## The data model

Operations are written against a record model that any backend can hold. This section defines the
terms the rest of the spec uses; it does not define how a backend stores anything.

> **Provisional.** This section stands in for the shared model spec of the Living Web family, which
> does not exist yet, and gives way to it: once that spec is published this section shrinks to a
> reference to it, and where the two differ the model spec wins. It is written in that spec's terms
> so the move is a cut, not a rewrite: _classes_ (here, entities), _properties_, _relations_ with a
> _cardinality_, the _write verbs_ (create, update, delete, and add, remove and set on a relation),
> _ordered collections_, and the _clearing rule_. The clearing rule below ([The absent-value
> rule](#the-absent-value-rule)) is WE's proposal for the shared rule, not a rule the family has
> settled.

**Dataset.** A set of records an operation reads and writes, chosen by the caller. An operation
runs against exactly one dataset.

**Record.** One stored thing. Every record has an `id`, a non-empty string unique within its
dataset, and belongs to one entity. A record an operation creates has an id derived from the
invocation, or from its identity where the create declares one ([Ids](execution.md#ids)). A backend MAY keep metadata on a record that no operation
writes: `author`, `createdAt`, `updatedAt` and `timestamp` are readable in a `find`'s `where` and
`order` and never written by an operation.

**Entity.** A record type, declared by name in a manifest's `entities` map. An entity declares
_properties_ (scalar fields) and _relations_ (fields holding other records), and MAY extend another
entity, inheriting both. An entity MAY be _abstract_: a base no record is ever created as. An
entity MAY be marked `blockable`, which places it in the `blockable` category.

**Property.** A named field of type `string`, `number`, `boolean`, `datetime` or `json`. A property
MAY be `required`, and MAY declare a `default`, the value a record reads back with when it has none.

- A `json` property holds one structured value (a list, an object, a number or a boolean) and reads
  back as the value written. It has no default. The whole value is the unit of writing: a write
  replaces it.

**Relation.** A named field whose values are other records, with a `cardinality` of `one` (to-one)
or `many` (to-many) and optionally a `target` entity. A to-many relation MAY be `ordered`, in which
case its members have an order that writes set and reads preserve ([Order](#order)).

The cardinality decides the value's shape, the same way in every write and every read:

- A **to-many** relation's value is a list of ids. It is written with `link`, `unlink` and
  `setRelation`, or as a list of ids (or records with an `id`) in a `create`'s or `update`'s
  fields. A read without `include` gives the list of ids; with `include`, the list of records.
- A **to-one** relation's value is **one id**. It is written as a field on `create` or `update`,
  never linked; the value written is that id, or a record with an `id`, which means its id. A
  write giving a to-one a list MUST be refused, whatever the list holds. A read without `include`
  gives the id itself, never a list holding it: as committed, as an `update` left it, as found by a
  `find`, and as a record this same operation created. With `include`, the record. A `where` compares a
  to-one with an id as it compares a property: `{ "node": { "$": "node" } }`.
- `''` or `null` written to a to-one clears it ([The absent-value rule](#the-absent-value-rule)).

> **Why one shape.** A to-one that read back as an id from one backend and as a list of one from
> another made every reader compare both ways (`r.node == node || node in r.node`), and a reader that
> forgot one form matched nothing on the backend that used it.

**Category.** A closed set of names standing for "every entity of a kind", resolved against the
entities registered when a step runs rather than when the operation was written:

| Category    | Members                                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blockable` | Every registered, non-abstract entity whose schema says `blockable: true`.                                                                                          |
| `any`       | Every non-abstract entity the dataset can read and write, including ones no registered manifest declares (a community's own record types, a foreign application's). |

No other category exists in this version. The access-control entities ([Protected
entities](execution.md#protected-entities)) are members of no category for writing: an operation
can never write them.

### Order

An order is part of the data, not of how one host draws it: two hosts reading the same records MUST
put them in the same order, and a host writing a new position MUST write what another host will read
as that position. There are two ways an order is held, and the model says which a relation uses.

**An ordered relation.** A to-many relation declared `ordered` holds its members as a sequence. The
sequence is the value: `setRelation` writes it whole, in the order given; `link` appends a member at
the end; `unlink` removes a member and leaves the others in their order; a `create` or `update` that
names the relation in its fields writes the list as given. Every read gives the members in that
order. A to-many relation that is not ordered is a set: a read MAY give its members in any order, and
nothing may depend on it. How a backend keeps the sequence (positions, a linked list, a CRDT) is its
own; what it reads back is not.

**A rank.** Where the position belongs to a record of its own rather than to a list (the place a card
holds on one canvas, which another canvas holding the same card does not share), the order is a
`number` property, its _rank_, and the records are read lowest rank first. One record per position
means a move is one write, and two people moving different cards in one row on two nodes do not
rewrite each other's. The rule, which every host writing ranks MUST follow:

1. **Reading.** Records with a rank come first, lowest first, two with the same rank by `id` in
   code-point order. Records without one come after, in whatever order the view gives them (when
   each was made, say), which a rank does not decide. `0` is not a rank: a rank property reads `0` as
   never set, so a record whose rank is `0` sorts with the unranked ones, and a host MUST NOT write
   `0` as a rank.
2. **Seating one record** at a position in a row (its siblings without it, in the order the reader
   sees them): when every sibling has a rank and the ranks rise strictly along the row, the record
   takes one rank and nothing else is written:
   - between two neighbours, their midpoint, `(before + after) / 2`;
   - after the last, `last + 1024`; before the first, `first − 1024`;
   - into an empty row, `1024`.

   The step, `1024`, is the gap a renumbering leaves, so many seatings into one gap are arithmetic.

3. **Renumbering.** Otherwise (a sibling without a rank, two siblings out of rising order, or a
   rank from step 2 that is `0` or does not land strictly between its neighbours because the gap has
   closed) the whole row, the record included at its new position, is renumbered `1024`, `2048`,
   `3072`, … in the order seen, and only the ranks that change are written, the seated record's
   always. Renumbering in the order the reader sees is what makes the order that persists the one on
   screen: an unranked record's place depends on how the host shows it, and a midpoint computed
   against it would land somewhere the reader did not put it.

> **Why two.** An ordered relation is the order of a thing somebody made as a sequence: a post's
> blocks, a board's columns, the cards a column lists. A rank is an order somebody imposed on records
> that belong to something else, per view, where rewriting a shared list on every move would make
> concurrent moves lose each other.

### Stored keys

A key a host derives from records and stores on one, so that another writer can recognise the same
thing by it, is part of the data in the same way: every host writing it MUST derive it the same way.
A connection between two records stores `connection`, its dedup key: the two ends' titles, each
trimmed, joined by `→`, followed by `: ` and the trimmed label when it has one
(`Launch the beta → Write the onboarding guide: depends on`). A writer that spelled it otherwise would
make every connection it draws a second copy of the one another writer, or an interpretation pass,
already stored.

### The absent-value rule

A field a record has never had written, and a field that was cleared, has **no value**. Three
written values mean no value:

- **Absent** — the field was not given.
- **`null`.**
- **`''`**, the empty string. An implementation MUST NOT store an empty string for a scalar field:
  writing `''` at creation, as a declared default, or in an edit, clears the field, and the record
  behaves exactly as if the field had never been written.

A value of no value matches no comparison: not equality, not inequality, not membership in a list or
out of one, not a range, and not a text match. The only test that matches it is `exists: false`
([The where-object](expressions.md#the-where-object)). A `required` field cannot be cleared; a write
that would clear one is refused.

An empty list and an empty object are values, not absences, so "none" and "not decided" stay
distinct.

> **Why `''` is absent.** Several backends cannot tell an empty string from no value, and a format
> that let the two differ would make a record mean different things on different backends.

---

Implemented by: [`manifest.ts`](../../../packages/backend-system/shared/src/manifest.ts) (entity
schema, `OPERATION_CATEGORIES`, `inCategory`), the reference implementations of [Order](#order):
[`treeRanks.ts`](../../../packages/app-shell/src/shared/kernels/treeRanks.ts) (`seatInRow`,
`rowFor`, `isRank`: ranks) and
[`boardArrangement.ts`](../../../packages/app-shell/src/shared/kernels/boardArrangement.ts)
(`arrangeBoard`: a board read through its ordered `children` and `arranges`),
[`connectionKey.ts`](../../../packages/app-shell/src/shared/kernels/connectionKey.ts) (`connectionKey`: a
connection's stored key),
[`recordContract.ts`](../../../packages/backend-system/shared/src/recordContract.ts) (`WriteValue`,
`json` properties), [`whereMatch.ts`](../../../packages/backend-system/shared/src/whereMatch.ts)
(`isAbsent`), [`registry.ts`](../../../packages/entities/src/operations/registry.ts)
(`categoryMembers`).
Pinned by: [`treeRanks.json`](../../../packages/app-shell/src/shared/kernels/vectors/treeRanks.json)
[`boardArrangement.json`](../../../packages/app-shell/src/shared/kernels/vectors/boardArrangement.json)
and [`connectionKey.json`](../../../packages/app-shell/src/shared/kernels/vectors/connectionKey.json)
(the order rules and the stored key, run by `app-shell/tests/treeRanks.test.ts`,
`boardArrangement.test.ts` and `connectionKey.test.ts`), the
`relations.ordered-read` and `relations.to-one-*` cases in
[`conformance/src/index.ts`](../../../packages/backend-system/conformance/src/index.ts), the
`relation-order` operations vector, [`emptyValues.ts`](../../../packages/backend-system/conformance/src/emptyValues.ts),
[`jsonValues.ts`](../../../packages/backend-system/conformance/src/jsonValues.ts),
[`inmemory/tests/operations.test.ts`](../../../packages/backend-system/inmemory/tests/operations.test.ts)
("a category in oneOf", "any record type").
