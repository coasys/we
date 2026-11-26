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

| File                          | What it specifies                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [This file](#the-data-model)  | The data model operations write: records, entities, fields, relations, categories, and the absent-value rule.                           |
| [Format](format.md)           | An operation definition: names and namespaces, params, errors, values, every step and its fields, static checks.                        |
| [Execution](execution.md)     | How an operation runs: invocation, names and scope, each step's semantics, ids, atomicity, the write check, errors, the effect summary. |
| [Expressions](expressions.md) | The expression subset: grammar, evaluation, the where-object, and the core function library.                                            |
| [Versioning](versioning.md)   | Compatible and incompatible changes to an operation, and how manifests and bundles signal format.                                       |
| [Conformance](conformance.md) | The vectors: their shape, how to run them, how results are compared, and which cases exist.                                             |

## The data model

Operations are written against a record model that any backend can hold. This section defines the
terms the rest of the spec uses; it does not define how a backend stores anything.

**Dataset.** A set of records an operation reads and writes, chosen by the caller. An operation
runs against exactly one dataset.

**Record.** One stored thing. Every record has an `id`, a non-empty string unique within its
dataset, and belongs to one entity. A backend MAY keep metadata on a record that no operation
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
case its members have an order that writes set and reads preserve.

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
schema, `OPERATION_CATEGORIES`, `inCategory`),
[`recordContract.ts`](../../../packages/backend-system/shared/src/recordContract.ts) (`WriteValue`,
`json` properties), [`whereMatch.ts`](../../../packages/backend-system/shared/src/whereMatch.ts)
(`isAbsent`), [`registry.ts`](../../../packages/entities/src/operations/registry.ts)
(`categoryMembers`).
Pinned by: [`emptyValues.ts`](../../../packages/backend-system/conformance/src/emptyValues.ts),
[`jsonValues.ts`](../../../packages/backend-system/conformance/src/jsonValues.ts),
[`inmemory/tests/operations.test.ts`](../../../packages/backend-system/inmemory/tests/operations.test.ts)
("a category in oneOf", "any record type").
