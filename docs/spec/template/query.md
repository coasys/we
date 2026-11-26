# Template format: queries

A query asks the backend for records. It names entities and relations from the data model
([Operations: the data model](../operations/README.md#the-data-model)) and never a backend: the host
compiles it to its backend's own question, and a backend that cannot answer part of it refuses it
rather than answering a different question.

A query is written `{ "$query": { … } }` at a position that takes one (`$each`'s `items`, `$single`'s
`item`), or as a named entry of a node's `$queries`. Its result is **always a list** of rows, one per
record, each an object holding the record's `id` and its fields.

**This is WE's copy of the query semantics.** It holds them until a shared query spec exists, and is
laid out by that spec's levels so that moving them there is a cut, not a rewrite. A backend says
which levels it implements, and a query using a level its backend lacks is [refused](#refusal).

| Level      | What it holds                                                                | Sections                                                                                                                                                                                          |
| ---------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| core       | the query object, conditions and combinators, order, limits, include, select | [The query object](#the-query-object), [Where](#where), [Order and limits](#order-and-limits), [Include](#include), [Select](#select), [Several entities](#several-entities), [Refusal](#refusal) |
| traversal  | a walk from anchor records: one step, transitive, by levels, per anchor      | [Scope](#scope)                                                                                                                                                                                   |
| aggregates | counts over a relation, and ordering by one                                  | [Counts](#counts)                                                                                                                                                                                 |
| live       | a query that follows the data                                                | [Following the data](#following-the-data)                                                                                                                                                         |
| provenance | conditions on who wrote a record                                             | [Provenance](#provenance)                                                                                                                                                                         |
| WE's own   | how a template states and asks a query; stays here when the rest moves       | [Unresolved operands and `when`](#unresolved-operands-and-when), [Hoisted queries](#hoisted-queries-queries)                                                                                      |

Three questions the shared spec has not settled are answered here the way WE answers them today, and
each is marked as WE's proposal where it applies: the **clearing rule** (whether `''` and `null` are
values), **union de-duplication** (which entity a record two entities answer with is listed under),
and **multi-valued scalars** (whether a property may hold several values). The vectors that pin them
are marked `pending`.

The semantics are pinned by the query vectors, `vectors/query/query.json` in
[`@we/backend-conformance`](../../../packages/backend-system/conformance/src/queryVectors.ts): a
dataset with its own entity schemas, and per case a query and the rows it answers with, tagged by
level ([Conformance](conformance.md#the-files)).

## The query object

_Level: core, except the keys marked._

| Key         | Value                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `entity`    | REQUIRED. An entity name; a list of names ([Several entities](#several-entities)); or an expression answering with either.                  |
| `where`     | A [where-object](#where).                                                                                                                   |
| `order`     | An object of field to `"asc"` or `"desc"`, or an expression answering with one ([Order and limits](#order-and-limits)).                     |
| `limit`     | A whole number ≥ 1, or an expression answering with one.                                                                                    |
| `offset`    | A whole number ≥ 0, or an expression answering with one. Only with `limit`.                                                                 |
| `include`   | Related records and projections to carry on each row ([Include](#include), [Counts](#counts)).                                              |
| `select`    | A list of field names each row carries ([Select](#select)).                                                                                 |
| `scope`     | Traversal. A walk from anchor records along a relation ([Scope](#scope)).                                                                   |
| `subscribe` | Live. `true` (the default): the result follows the data. `false`: read once. An expression: follow while it is truthy, read once otherwise. |
| `when`      | WE's own. An expression: the query is asked only while it is truthy ([Unresolved operands](#unresolved-operands-and-when)).                 |
| `dataset`   | WE's own. Which dataset to read, by a host value or store path naming one. Default: the dataset on screen.                                  |

Every operand may be an expression, resolved against the context where the query stands; the query
is asked again when one changes. An entity named by an expression that has not answered yet is a
query not yet asked, not one answered with nothing.

A writer SHOULD name a literal entity wherever the type is known: a validator can check a literal
name and cannot check one only known at run time.

---

Implemented by: [`types.ts`](../../../packages/schema-system/shared/src/types.ts) (`QueryToken`),
[`zodSchemas.ts`](../../../packages/schema-system/shared/src/zodSchemas.ts) (`zQuery`),
[`query.ts`](../../../packages/schema-system/shared/src/propResolvers/query.ts) (`resolveQueryProp`),
[`queryCompiler.ts`](../../../packages/backend-system/shared/src/queryCompiler.ts) (`compileQuery`),
[`queryRouting.ts`](../../../packages/backend-system/shared/src/queryRouting.ts).
Pinned by: `query-compile.json` family `q`; [`query.test.ts`](../../../packages/schema-system/shared/src/propResolvers/query.test.ts).

## Where

_Level: core._

`where` is a where-object, with exactly the grammar and meaning of
[the operations where-object](../operations/expressions.md#the-where-object): field conditions
(equality, a list, `not`, `contains`, `startsWith`, `endsWith`, the range bounds `gt`, `gte`, `lt`,
`lte`, and `exists`), the relation quantifiers `some` and `none`, and the combinators `AND`, `OR`,
`NOT`. The same where-object passed to `filter()` or `find()` in an expression selects the same rows
from the same records.

**The absent value matches nothing.** A field with no value (never written, cleared, `null` or `''`)
matches no condition but `exists: false`: not equality, not `not`, not a list, not a range and not a
text match. This holds in a query and in `filter()` and `find()` alike. So
`{ assignee: { not: 'Ann' } }` does not find a task nobody is assigned to; a template that wants it
says so with `OR` and `exists: false`.

That `''` and `null` are the absent value is WE's proposal for the clearing rule (see above). So is
how a list held in one field is read: a property holds one value, and a list written to a `json`
property is one value, which equality with one of its entries does not match. Whether a property may
hold several values is the multi-valued scalars question.

**What a backend runs.** Every backend MUST run equality, lists, `not`, `contains`, numeric range
bounds, `some`, `none` and the combinators. `exists`, `startsWith`, `endsWith` and text range bounds
are part of the format, and a backend MAY not support them in a query; a query using one there is
refused ([Refusal](#refusal)), never answered as if the condition were not there. Inside `filter()`
and `find()` every operator works on every host.

> **Why one where-object.** A query and a filter that disagreed about the absent value would show a
> record in a list and hide it from the same list's search. One grammar, one meaning.

---

Implemented by: [`queryCompiler.ts`](../../../packages/backend-system/shared/src/queryCompiler.ts)
(`translateWhere`), [`whereMatch.ts`](../../../packages/backend-system/shared/src/whereMatch.ts),
[`where.ts`](../../../packages/schema-system/expressions/src/where.ts),
[`queryCapabilities.ts`](../../../packages/backend-system/shared/src/queryCapabilities.ts).
Pinned by: `query.core.where-*`; `query-compile.json` (`q.where`, `q.where-in`, `q.where-ops`);
[`whereMatch.test.ts`](../../../packages/backend-system/shared/src/whereMatch.test.ts); the backend
conformance suite's empty-value cases.

## Order and limits

_Level: core._

`order` is an object of field to direction; its keys apply in the order written. A key may also be a
**dotted path** `relation.field`, ordering by a field of a to-one or to-many related record. Such a
key MUST be the only key of `order`, and the query MUST have a `limit`; without one a host MAY ignore
the order.

`limit` keeps the first rows of the order; `offset` skips rows before them. An `offset` without a
`limit` is refused.

---

Implemented by: [`queryCompiler.ts`](../../../packages/backend-system/shared/src/queryCompiler.ts)
(`translateOrder`, `compileQuery`).
Pinned by: `query.core.order-*`, `query.core.limit*`, `query.core.offset-without-limit`;
`query-compile.json` (`q.order-limit`).

## Include

_Level: core._

`include` carries related records on each row, in place of their ids. Each key is a relation, or a
projection name starting with `$`:

| Value                                              | Each row carries                                                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `rel: true`                                        | Under `rel`, the related record (to-one) or the list of them (to-many), each a row.                            |
| `rel: { where, order, limit, select, include }`    | The same, filtered, ordered, limited and nested as the keys say, to any depth.                                 |
| `$name: { from, where?, order?, select?, limit? }` | Under `$name`, the records of `from` that match; with `limit: 1`, the first such record or `null`, not a list. |

A projection that counts is under [Counts](#counts).

An included relation is the **record**, not its id: `row.item == x` compares a record with an id
and never matches. Compare `row.item.id`.

A relation with no declared target (a collection's `children`) is read polymorphically: each member
as the entity it is, carrying its entity name under `__subjectClass`. Below such a relation only a
relation with a declared target may be nested.

An ordered to-many relation comes back in its stored order.

---

Implemented by: [`queryCompiler.ts`](../../../packages/backend-system/shared/src/queryCompiler.ts)
(`translateInclude`), [`queryEngine.ts`](../../../packages/backend-system/shared/src/queryEngine.ts)
(`hydrate`).
Pinned by: `query.core.include-*`, `query.core.projection-*`; `query-compile.json` (`q.include`).

## Select

_Level: core._

`select` names the fields each row carries: properties, and relations as their members' ids. `id`
always comes. A field left out reads as no value. Without `select` a row carries every field.

---

Implemented by: [`queryCompiler.ts`](../../../packages/backend-system/shared/src/queryCompiler.ts)
(`compileQuery`), [`queryEngine.ts`](../../../packages/backend-system/shared/src/queryEngine.ts).
Pinned by: `query.core.select*`, `query.core.include-select`.

## Several entities

_Level: core._

`entity` as a list asks the same question of every entity in it and answers with one list:

- each row carries the entity it came from under `__subjectClass`;
- a record two of the entities both answer with is listed once, as the first of them in the list
  (WE's proposal for union de-duplication);
- `order` and `limit` apply to the whole list; `offset` is refused;
- the result is not drawn until every entity has answered once, and an empty list of entities is an
  answer: loaded, no rows;
- an entity that cannot be read is reported and counts as having no rows; the others still show.

---

Implemented by: [`queryUnion.ts`](../../../packages/backend-system/shared/src/queryUnion.ts).
Pinned by: `query.core.entities-*`;
[`queryUnion.test.ts`](../../../packages/backend-system/shared/src/queryUnion.test.ts);
`query-compile.json` (`q.expr-entity`).

## Refusal

_Level: core._

When the host cannot compile a query, or its backend reports that it cannot run a feature the query
uses, the host MUST refuse it: the query is not run, its result is `[]`, and the host reports why. A
host MUST NOT hand the backend a query it has not agreed to read, and MUST NOT answer a query with a
feature silently dropped, except where the backend declares that feature _degraded_ (it runs, and one
named feature is ignored), in which case the host runs it and reports the degradation.

A backend's known gaps against the query vectors are the cases it refuses or answers differently,
listed with the reason and run inverted, so a gap that closes is noticed.

---

Implemented by: [`queryRouting.ts`](../../../packages/backend-system/shared/src/queryRouting.ts),
[`queryCapabilities.ts`](../../../packages/backend-system/shared/src/queryCapabilities.ts).
Pinned by: `query.core.offset-without-limit`, `query.core.entities-offset`;
[`queryRouting.test.ts`](../../../packages/backend-system/shared/src/queryRouting.test.ts),
[`queryCapabilities.test.ts`](../../../packages/backend-system/shared/src/queryCapabilities.test.ts).

## Scope

_Level: traversal._

`scope` reads the records reached from anchor records along a relation, instead of the whole dataset:

| Key              | Value                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| `via`            | REQUIRED. The relation walked.                                                                                      |
| `anchorId`       | REQUIRED. An anchor's id, or a list of them: one question asked of every anchor at once.                            |
| `anchor`         | The anchors' entity.                                                                                                |
| `direction`      | `"out"` (the default): the records the anchors' `via` holds. `"in"`: the records whose `via` holds an anchor.       |
| `transitive`     | `true`: every record reached at any depth, not one step.                                                            |
| `levels`         | A list of whole numbers (or expressions): walk depth by depth, keeping at most that many per record at each depth.  |
| `limitPerAnchor` | A whole number: at most that many per anchor, for one step. Not a substitute for `levels`: one anchor is one group. |

The anchors are not in the result. A walked result is **flat**: a row says it was reached, never
from where; a template that draws the tree includes the inverse relation and rebuilds it. `where`,
`order` and `limit` apply to what was reached.

Which records a bounded walk keeps when it must drop some is not specified in this version, beyond
`order` deciding among siblings where one is given.

---

Implemented by: [`queryCompiler.ts`](../../../packages/backend-system/shared/src/queryCompiler.ts),
[`queryIR.ts`](../../../packages/backend-system/shared/src/queryIR.ts) (`Scope`),
[`queryEngine.ts`](../../../packages/backend-system/shared/src/queryEngine.ts) (`scopeRows`),
[`queryCapabilities.ts`](../../../packages/backend-system/shared/src/queryCapabilities.ts)
(`boundedTraversal`).
Pinned by: `query.traversal.*`; `query-compile.json` (`q.scope`, `q.everything`); the scope cases
of the [operations vectors](../operations/conformance.md#the-cases) (`find-scope-levels`,
`find-scope-transitive`).

## Counts

_Level: aggregates._

A projection with `count: true` carries a number:

| Value                                               | Each row carries                                                                                                        |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `$name: { from, count: true, where?, transitive? }` | Under `$name`, how many records `from` (a relation) holds that match `where`; with `transitive`, at any depth along it. |

A count may stand at any level of an `include`, and rides on each included record. Below a relation
with no declared target, each member counts for its own entity, and a member whose entity has no
relation `from` carries no count rather than `0`.

`order` may name a count projection (`{ "$likeCount": "desc" }`). Such a key MUST be the only key of
`order`, and the query MUST have a `limit`; without one a host MAY ignore the order, and the rows are
the same.

---

Implemented by: [`queryCompiler.ts`](../../../packages/backend-system/shared/src/queryCompiler.ts)
(`translateInclude`), [`queryEngine.ts`](../../../packages/backend-system/shared/src/queryEngine.ts)
(`computeAggregate`).
Pinned by: `query.aggregates.*`.

## Following the data

_Level: live._

A query with `subscribe` true (the default) follows the data. It opens on its first result, and that
first result is flagged _initial_; every later result is one that differs from the last, and is not
initial. A write that changes the answer is followed, whether it changes a record the query reads,
a record it includes, or what a relation it counts or walks holds. A query read once keeps the
answer it was given.

The handle a backend hands over for this is the one in
[`liveQuery.ts`](../../../packages/backend-system/shared/src/liveQuery.ts): a first result, a snapshot,
a subscription and a way to stop.

---

Implemented by: [`liveQuery.ts`](../../../packages/backend-system/shared/src/liveQuery.ts)
(`LiveQuery`, `createLiveQuery`, `combineLiveQueries`).
Pinned by: `query.live.*`; the backend conformance suite's live cases.

## Provenance

_Level: provenance._

Every record carries `author`, the agent that wrote it, and a condition on `author` is a condition
like any other: `{ "author": { "not": [did] } }` leaves out what one agent wrote.

> **Planned.** Conditions on who wrote each statement of a record, and on whether a record's
> signature is verified, are not in this version.

---

Implemented by: [`whereMatch.ts`](../../../packages/backend-system/shared/src/whereMatch.ts).
Pinned by: `query.provenance.*`.

## Unresolved operands and `when`

_WE's own: how a template's query waits._

An operand whose expression has no value yet (a store not loaded, a local not chosen) is
**pruned**, and pruning widens:

- **In `where`**, a condition whose operand is no value is dropped, and a combinator left with no
  branch is dropped. Only no value is unresolved: `null`, `''`, `false` and `0` are values and stay.
  A `not` holding an empty list excludes nothing and is dropped.
- **In `scope`**, an `anchorId` that is no value, `null` or `''` drops the scope, so the query reads
  the whole dataset. An empty list of anchors is still anchored, and answers with nothing.
- **A bound is the exception.** A `limit` or `offset` whose expression has no value does not widen:
  the query is not asked until it has one.

`when` is how a query waits instead of widening. While `when` is falsy the query is not asked, its
result is `[]`, and its `Loaded` flag stays false ([Hoisted queries](#hoisted-queries-queries)).

> **Why widen.** An optional filter that has not resolved means "do not narrow by this yet". A bound
> that widened would ask the backend for everything there is, which is never what anyone meant.

---

Implemented by: [`query.ts`](../../../packages/schema-system/shared/src/propResolvers/query.ts)
(`pruneUnresolvedWhere`, `scopeIsAnchored`),
[`SchemaRenderer.tsx`](../../../packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx)
(`unresolvedBound`, `when`).
Pinned by: `query-compile.json` families `w` and `s`, and `q.when`, `q.when-false`;
`query.core.when-*`.

## Hoisted queries: `$queries`

_WE's own._

A node MAY declare `$queries`, an object of name to query object (the same keys as above). Each runs
while the node is mounted, and its rows are readable in the node's subtree as `local.<name>`, with
`local.<name>Loaded`, `false` until the first answer (or error) arrives and `true` after. They are
read-only: a handler that writes one does nothing.

`$queries` and `$localState` share the `local` names, and a node MUST NOT declare one name in both.
An entry's operands MAY read a sibling entry on the same node, whatever order they are written in,
and it is asked again when that sibling answers.

A query cannot be read inside an expression. A question for the backend is hoisted here and read
back through `local`.

---

Implemented by: [`SchemaRenderer.tsx`](../../../packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx)
(`$queries`, `createQuerySignal`).
Pinned by: [`semanticValidation.test.ts`](../../../packages/schema-system/shared/tests/semanticValidation.test.ts).

> **Planned.** Render vectors for `$queries` and `$single` with an answer, which need a data source
> in the renderer suite.
