# Operations: the format

An operation is a JSON object. This file defines its shape. How each part behaves when the
operation runs is in [Execution](execution.md); the expression language its values use is in
[Expressions](expressions.md).

## Where operations are declared

Operations are declared in a manifest, in an `operations` object beside `entities`:

```json
{
  "version": "3",
  "entities": { "…": "…" },
  "operations": {
    "makeBoard": { "description": "…", "params": {}, "steps": [] }
  }
}
```

The keys of `operations` are **bare names**. A name MUST match `[A-Za-z_][A-Za-z0-9_]*`.

**Namespaces are assigned by the host.** An operation is addressed as `<namespace>.<name>`
(`core.makeBoard`, `polls.vote`). The namespace is the one the host gives whoever declared the
manifest: its own vocabulary, a module's id, an installed bundle's id. A manifest MUST NOT be able to
choose its namespace, and a host MUST NOT let one manifest's operations be registered under another
declarer's namespace. A namespace MUST match `[a-z][a-z0-9-]*`.

> **Why.** If a manifest could name its namespace, a bundle could register `core.createPost` and
> every caller of the real one would run the bundle's.

## An operation definition

```json
{
  "description": "A board and a column under it for each column given.",
  "params": {
    "title": { "type": "string", "required": true },
    "columns": { "type": "list", "required": true }
  },
  "errors": { "untitled": "A board needs a title." },
  "steps": [
    { "check": { "condition": { "$": "trim(title) != ''" }, "error": "untitled" } },
    {
      "create": { "as": "board", "entity": "CollectionBlock", "fields": { "kind": "board", "title": { "$": "title" } } }
    },
    {
      "forEach": {
        "in": { "$": "columns" },
        "as": "col",
        "steps": [
          {
            "create": {
              "as": "column",
              "entity": "CollectionBlock",
              "fields": { "kind": "column", "title": { "$": "col.title" } }
            }
          },
          {
            "link": {
              "entity": "CollectionBlock",
              "id": { "$": "board.id" },
              "relation": "children",
              "target": { "$": "column.id" }
            }
          }
        ]
      }
    }
  ],
  "returns": { "$": "board.id" }
}
```

| Key           | Required | Value                                                                                                                                                 |
| ------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description` | yes      | One sentence saying what the operation does, for a person or a language model deciding whether to call it.                                            |
| `params`      | no       | An object of param name to [param](#params).                                                                                                          |
| `errors`      | no       | An object of error name to a person-readable message: the precondition errors its `check` steps raise. Each name MUST match `[A-Za-z_][A-Za-z0-9_]*`. |
| `steps`       | yes      | A list of [steps](#steps), run in the order written.                                                                                                  |
| `returns`     | no       | A [value](#values) evaluated after the last step and handed to the caller.                                                                            |
| `serial`      | no       | An [expression](#values) over the params naming the queue an invocation joins: see [Serial](#serial).                                                 |

**Objects are strict.** An operation definition, a param and every step body MUST NOT carry a key
this spec does not define. An implementation MUST refuse a definition that does (as a static
`malformed` error), not ignore the key.

> **Why.** An implementation that dropped an unknown key would run a different operation from the
> one written: a misspelt `when` would make a guarded step unconditional.

## Serial

```json
{ "serial": { "$": "'signal ' + node + ' ' + signalType" } }
```

`serial` is an expression token whose expression reads only the operation's params. Its value for an
invocation, when it is a non-empty string or a finite number (as text), is the invocation's **queue
key**; any other value means the invocation joins no queue. Two operations whose keys come out as the
same text share the queue: a give and a take-back of one reaction declare the same key.

What a host does with the key is in [Execution](execution.md#serial): invocations with the same key in
the same dataset run one after another.

> **Why.** An operation that reads before it writes cannot defend itself against a second invocation
> reading at the same moment: both find the same stored reaction, and each makes a replacement. A
> transaction does not help — each run is atomic and both are correct on their own. The order has to
> be kept by whoever starts the runs, and the definition is the place that knows which runs touch the
> same thing.

## Params

```json
{ "type": "string", "required": true, "description": "The record voted on." }
```

| Key           | Required | Value                                 |
| ------------- | -------- | ------------------------------------- |
| `type`        | yes      | One of the types below.               |
| `required`    | no       | Boolean, default `false`.             |
| `description` | no       | Text for whoever calls the operation. |

| Type      | Accepts                                   |
| --------- | ----------------------------------------- |
| `string`  | A JSON string.                            |
| `number`  | A finite JSON number.                     |
| `boolean` | `true` or `false`.                        |
| `list`    | A JSON array.                             |
| `object`  | A JSON object (not an array, not `null`). |
| `json`    | Anything.                                 |

A param name MUST match `[A-Za-z_][A-Za-z0-9_]*`, MUST NOT be `invoker` or `invokedAt`, and MUST NOT
be an expression keyword (`true`, `false`, `null`, `in`). How args are checked against params is in
[Execution: args](execution.md#args).

## Values

Wherever this spec says a field takes a **value**:

- a JSON object of exactly one key, `$`, whose value is a string, is an **expression**:
  `{ "$": "board.id" }`. It is evaluated by the rules in [Expressions](expressions.md) over the
  names bound where it sits ([Execution: names](execution.md#names-and-scope));
- any other JSON object or array is evaluated entry by entry, so an object or a list MAY hold
  expressions at any depth: `{ "kind": "board", "title": { "$": "title" } }`;
- anything else is a literal and means itself.

`{ "$": … }` is the only spelling of an expression. A string is always a literal, whatever it
contains.

A **where-object** is a value whose evaluated result is read by the rules of
[The where-object](expressions.md#the-where-object).

## Steps

A step is a JSON object with **exactly one verb key**, whose value is the step's body, and
optionally a `when`:

```json
{
  "when": { "$": "count(found) == 0" },
  "create": { "as": "made", "entity": "Tag", "fields": { "slug": { "$": "slug" } } }
}
```

The verbs are a **closed set**: `find`, `create`, `update`, `delete`, `link`, `unlink`,
`setRelation`, `forEach`, `check` and `call`. An implementation that meets any other key on a step
MUST refuse the operation.

`when`, on any step, is a value. The step runs only when it evaluates to a truthy value
([truthiness](expressions.md#truthiness)).

An `as` names the step's result for the steps after it. An `as` MUST match `[A-Za-z_][A-Za-z0-9_]*`
and MUST NOT be an expression keyword.

In the tables below, _value_ means a [value](#values); _entity_ means either a literal entity name
or an expression together with a `oneOf` ([Chosen entities](#chosen-entities)); a field marked
**required** MUST be present (a present key whose value is `null` counts as present for the format,
and is read at run time as no value).

### `find`

Reads records of one entity from committed state.

| Key      | Required | Value                                                                                                |
| -------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `as`     | yes      | The name its result is bound to.                                                                     |
| `entity` | yes      | A literal entity name. Not an expression.                                                            |
| `where`  | no       | A where-object.                                                                                      |
| `order`  | no       | A literal object of field name to `"asc"` or `"desc"`.                                               |
| `limit`  | no       | A value giving a whole number ≥ 0.                                                                   |
| `scope`  | no       | A [scope](#scope).                                                                                   |
| `one`    | no       | Boolean. When true the result is exactly one record or the step fails.                               |
| `expect` | no       | Boolean. When true the find is read again before commit and the operation fails if its answer moved. |

#### Scope

Restricts a find to records held under one anchor record through one of its relations.

| Key          | Required | Value                                                                                                                        |
| ------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `anchor`     | yes      | The anchor's entity name. An abstract entity means any entity holding the relation.                                          |
| `via`        | yes      | The anchor's relation whose members are this find's records.                                                                 |
| `anchorId`   | yes      | A value giving the anchor record or its id.                                                                                  |
| `levels`     | no       | A non-empty list of positive integers: walk the relation depth by depth, keeping at most that many per record at each depth. |
| `transitive` | no       | `true`: walk the relation to the bottom.                                                                                     |

`levels` and `transitive` MUST NOT both be given. Either way the result is flat: every record
reached, at any depth, and nothing about where it sits. There is one anchor; a list of anchors is
not part of this version.

### `create`

Creates one record.

| Key        | Required                    | Value                                                                                                                                                                                                                                                |
| ---------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `as`       | no                          | The name the created record is bound to.                                                                                                                                                                                                             |
| `entity`   | yes                         | An entity.                                                                                                                                                                                                                                           |
| `oneOf`    | with an expression `entity` | See [Chosen entities](#chosen-entities).                                                                                                                                                                                                             |
| `fields`   | yes                         | An object of field name to value, or one expression giving the whole object.                                                                                                                                                                         |
| `parent`   | no                          | `{ "id": value, "relation": name, "entity"?: name }`: a record this one is created under, through the parent's to-many relation `relation`. `entity` names the parent's entity where the relation's name alone does not decide it. `id` is required. |
| `identity` | no                          | A literal non-empty list of field names: the record's **identity**. Its id derives from the entity and these fields' values rather than from the invocation ([Identity ids](execution.md#identity-ids)).                                             |

`fields` MUST NOT name `id`: a created record's id is derived ([Ids](execution.md#ids)). The same
holds for `update`.

**Identity.** A record type whose records are one per value of some fields (a task state per slug,
a role per slug) says so on its creates: `"identity": ["slug"]`. The create's `entity` MUST be a
literal name; each field MUST be a property or a to-one relation of that entity, named once, and
given in a literal `fields`. Every create of the same identity, by any invocation on any node, names
the same record: a second one is refused as `recordExists`, and on a backend that merges what
several nodes wrote, the writes land on one record rather than making two.

> **Why on the create.** The id has to be known when the record is made, by whoever makes it, with
> no read: a read sees only what this node has, and two nodes naming the same thing at once would
> each see nothing and make one each. The name is the model's (the `identity` profile of the shared
> model spec), for the same meaning: these fields say which record this is.

### `update`

Edits one record's fields.

| Key      | Required                    | Value                                                                  |
| -------- | --------------------------- | ---------------------------------------------------------------------- |
| `entity` | yes                         | An entity.                                                             |
| `oneOf`  | with an expression `entity` | See [Chosen entities](#chosen-entities).                               |
| `id`     | yes                         | A value giving the record or its id.                                   |
| `fields` | no                          | An object of field name to value, or one expression giving the object. |
| `unset`  | no                          | A literal list of property names to clear.                             |

### `delete`

| Key      | Required                    | Value                                    |
| -------- | --------------------------- | ---------------------------------------- |
| `entity` | yes                         | An entity.                               |
| `oneOf`  | with an expression `entity` | See [Chosen entities](#chosen-entities). |
| `id`     | yes                         | A value giving the record or its id.     |
| `own`    | no                          | `true`: only a record the invoker made.  |

`own` is what taking back one's own contribution says (a reaction withdrawn, an answer replaced): the
run refuses to delete a record somebody else made, and the [effect summary](execution.md#the-effect-summary)
does not count the step as destructive.

### `link` and `unlink`

Add one record to, or take one out of, a to-many relation.

| Key        | Required                    | Value                                                                                                              |
| ---------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `entity`   | yes                         | An entity: the entity of the record holding the relation.                                                          |
| `oneOf`    | with an expression `entity` | See [Chosen entities](#chosen-entities).                                                                           |
| `id`       | yes                         | A value giving the holding record or its id.                                                                       |
| `relation` | yes                         | A literal relation name, or an expression giving one.                                                              |
| `target`   | yes                         | A value giving the member record or its id.                                                                        |
| `strict`   | no                          | Boolean, default `false`. Strict `link` fails when the target is already a member; strict `unlink` when it is not. |

> **Why strict and lenient.** LD Patch's `AddNew` and `DeleteExisting`: a lenient write states the
> end state and is idempotent; a strict one also asserts the state it started from.

### `setRelation`

Replaces a to-many relation's whole membership, in order.

| Key        | Required                    | Value                                                              |
| ---------- | --------------------------- | ------------------------------------------------------------------ |
| `entity`   | yes                         | An entity.                                                         |
| `oneOf`    | with an expression `entity` | See [Chosen entities](#chosen-entities).                           |
| `id`       | yes                         | A value giving the holding record or its id.                       |
| `relation` | yes                         | A literal relation name, or an expression giving one.              |
| `targets`  | yes                         | A value giving a list of records or ids: the whole new membership. |
| `keep`     | no                          | `true`: members `targets` leaves out stay, after it.               |

With `keep`, `targets` is the order wanted for the members it names, and every member it leaves out
follows them in the order it held: the step orders and adds, and never removes, which is what a drag
reordering a column or a board says. The effect summary records it as an addition only.

### `forEach`

Runs its steps once per item of a list.

| Key     | Required | Value                                                                                             |
| ------- | -------- | ------------------------------------------------------------------------------------------------- |
| `in`    | yes      | A value giving a list.                                                                            |
| `as`    | yes      | The name each item is bound to inside the body.                                                   |
| `key`   | no       | An expression over the item giving its stable identity. Default: the item's `id`, else its `key`. |
| `steps` | yes      | A list of steps: the body.                                                                        |

`forEach` steps nest at most **three** deep within one definition. A `forEach` binds no name after
itself; its `as` is visible only inside its body.

> **Why no recursion.** A tree is passed flattened by the caller, or found with a scope walk
> (`levels`, `transitive`). A bounded nesting keeps every operation's cost and its effect summary
> finite.

### `check`

Fails the operation with a named error when a condition is false.

| Key         | Required | Value                                        |
| ----------- | -------- | -------------------------------------------- |
| `condition` | yes      | A value.                                     |
| `error`     | yes      | A name declared in the operation's `errors`. |

### `call`

Runs another operation within this one.

| Key         | Required | Value                                                                 |
| ----------- | -------- | --------------------------------------------------------------------- |
| `as`        | no       | The name the called operation's `returns` is bound to.                |
| `operation` | yes      | A qualified name, matching `[a-z][a-z0-9-]*\.[A-Za-z_][A-Za-z0-9_]*`. |
| `args`      | no       | An object of param name to value.                                     |

The graph of calls, followed through every namespace, MUST be acyclic.

### Chosen entities

Every write verb (`create`, `update`, `delete`, `link`, `unlink`, `setRelation`) takes `entity` as
either a literal name or an expression. An expression `entity` MUST come with `oneOf`, a non-empty
list of what the expression's value may be, each entry being either:

- an entity name, or
- a category: `{ "category": "blockable" }` or `{ "category": "any" }` ([categories](README.md#the-data-model)).

A literal `entity` MUST NOT carry `oneOf`.

With a category in `oneOf`, the members are not all known when the operation is written, so:

- a `create` or `update` MUST take `fields` as one expression, not a literal field map;
- an `update` MUST NOT use `unset` (it clears a field by giving it `''` or `null`).

With only names in `oneOf`, a literal field map MUST name only fields every listed entity has.

> **Why.** A post's blocks are whichever block types the host has registered, including a module's
> that the operation's author never saw. Naming the category lets the operation write them; checking
> the value at run time keeps it from writing anything else.

## Static checks

An implementation MUST refuse to register a manifest whose operations break any of these, and
SHOULD report each problem with a path to it (`operations.vote.steps.2.forEach.steps.0.create.fields.text`):

1. The structure above: strict objects, required keys, the closed verb set, `levels` with
   `transitive`.
2. Every name an expression reads is bound where it reads it ([Names and
   scope](execution.md#names-and-scope)).
3. No `as` reuses a name already visible where it is bound (a param, `invoker`, `invokedAt`, an
   earlier step's `as`, an enclosing loop's item). No param is named `invoker` or `invokedAt`, and no
   param or `as` is an expression keyword.
4. Every expression parses ([Grammar](expressions.md#grammar)) and calls only core functions, each
   with an argument count its signature allows ([Core functions](expressions.md#core-functions)).
5. Every entity named, in a step or a `oneOf`, is known, counting inherited properties and relations;
   every `oneOf` entry is a name or a known category.
6. No write names an access-control entity ([Protected entities](execution.md#protected-entities)).
7. A `create` does not create an abstract entity, and gives every required property that has no
   default, where `fields` is a literal map. No `create` or `update` names `id` in a literal `fields`.
8. Every field named in a literal `fields`, `where` or `order` exists on its entity; `where` and
   `order` may also name the record metadata (`id`, `author`, `createdAt`, `updatedAt`, `timestamp`).
   A `some`/`none` clause in a `where` is checked against the relation's target entity, where the
   relation names one.
9. Every property in `unset` exists and is not required.
10. A literal `relation` on `link`, `unlink` or `setRelation`, and a `parent.relation` with a
    `parent.entity`, is a to-many relation of its entity. A `parent.relation` without `entity` is a
    relation some known entity declares. A `scope.via` is a relation of `scope.anchor`.
11. Every `check.error` is declared in `errors`.
12. Every `call` names a known operation, passes only params it declares, and passes every one it
    requires. The call graph is acyclic.
13. `forEach` nests at most three deep. A `forEach` without `key` whose `in` is a literal list has
    an `id` or a `key` on every item.
14. A `create` with `identity` names a literal entity, and each identity field once, each a property
    or a to-one relation of the entity and, where `fields` is a literal map, given in it.
15. `serial` is an expression token, and every name it reads is a param.

Checks 5 and 8 to 10 do not apply to the members of `{ "category": "any" }`, which nothing in view
stands for, nor to a `relation` given as an expression: those are judged by the backend when the
step runs. Entities declared outside the manifest that the operations may use (the host's own
vocabulary, a bundle's other record types) count as known when the host supplies them.

---

Implemented by: [`manifest.ts`](../../../packages/backend-system/shared/src/manifest.ts)
(`OperationDefinition`, `operationsSchema`),
[`validate.ts`](../../../packages/entities/src/operations/validate.ts) (`validateOperations`),
[`registry.ts`](../../../packages/entities/src/operations/registry.ts) (namespaces).
Pinned by: [`entities/tests/operations.test.ts`](../../../packages/entities/tests/operations.test.ts)
("static checks", "a serial key", "the core operations").
