# Template format: values

A prop's value, a `$localState` initial, a query operand and a handler's argument are all _values_:
JSON, in which some objects are tokens. This file says how a value is read.

## What a value holds

| JSON                              | Read as                                                                                                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| a string                          | **Text**, always. A string is never a reference, whatever it starts with.                                                               |
| a number, `true`, `false`, `null` | Itself.                                                                                                                                 |
| `{ "$": "…" }`                    | **An expression** ([Expressions](expressions.md)): its value, recomputed whenever what it reads changes.                                |
| `{ "$query": { … } }`             | **A query** ([Queries](query.md)), only where a position takes one: `$each`'s `items`, `$single`'s `item`. Anywhere else it is invalid. |
| a handler token                   | **A handler** ([Handlers](handlers.md)), only in an event prop or inside another handler.                                               |
| a node                            | A node, in a [node prop](nodes.md#child-positions); **data** anywhere else.                                                             |
| any other object, or a list       | Itself, with every token inside it read the same way, to any depth a renderer supports (at least ten levels).                           |

**Tokens are closed.** An object with a key starting with `$` is a token, and MUST be one of the
tokens this spec defines, written in its exact shape: `{ "$": text }` and nothing else; a handler with
only the keys its verb takes. An object holding a `$` key that is none of them is invalid. The one
exception is a node, which may carry `$localState`, `$queries` and `$defs` beside its `type`.

> **Why a string is text.** A string used to be a reference when it began with `$`, so its meaning
> depended on what was in scope, and `'$psot.title'` drew nothing with nobody told. A reference is
> always written `{ "$": "post.title" }`, which a validator can check name by name.

Every value is resolved where it stands, against the [context](README.md#terms) and the bag at that
position. An expression is **reactive**: a renderer MUST redraw what depends on it when a value it
read changes, and SHOULD redraw nothing else.

---

Implemented by: [`dispatcher.ts`](../../../packages/schema-system/shared/src/propResolvers/dispatcher.ts)
(`resolveProp`), [`expression.ts`](../../../packages/schema-system/shared/src/propResolvers/expression.ts),
[`zodSchemas.ts`](../../../packages/schema-system/shared/src/zodSchemas.ts) (`zSchemaProp`,
`zPropToken`).
Pinned by: [`propResolvers.test.ts`](../../../packages/schema-system/shared/tests/propResolvers.test.ts),
[`tokenSchemas.test.ts`](../../../packages/schema-system/shared/tests/tokenSchemas.test.ts); render
vectors `render.node.reactive-prop`, `render.degrade.failing-expression`.

## Render time and call time

Most values are resolved when they are drawn. An expression that names `event`, `arg` or `result`
(the [call-time roots](expressions.md#call-time-roots)) is about a callback that has not fired yet,
and is resolved when it fires, at these positions only:

- an entry of an `$invoke`'s `args`, or a value inside one;
- a `$setLocal`'s `value`, or a value in its `merge`;
- a `$toggleLocalIn`'s `value`;
- a handler `$if`'s `condition`;
- anything inside a lifecycle callback or a handler list, which already run at call time.

Anywhere else (a prop drawn on screen, a query operand, a `$localState` initial) a call-time root is
invalid: there is no event to read, and the value would be fixed at no value. A validator MUST report
it.

---

Implemented by: [`expression.ts`](../../../packages/schema-system/shared/src/propResolvers/expression.ts)
(`DEFERRED_ARG`), [`invoke.ts`](../../../packages/schema-system/shared/src/propResolvers/invoke.ts).
Pinned by: render vectors `render.handler.invoke-event-detail`, `render.handler.set-local-event`,
`render.handler.if-event`.

## Validation rules

A `$localState` field MAY carry `validate`, a list of rules its value is judged by
([Local state](handlers.md#local-state)). Each rule is an object with `rule` and an optional
`message`, the text reported when it fails:

| `rule`      | Takes                       | Fails when                                                                                                                                       |
| ----------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `required`  |                             | The value is no value, `null` or `''`.                                                                                                           |
| `minLength` | `value`, a whole number ≥ 1 | The value is not text at least `value` UTF-16 code units long (anything but text counts as length 0).                                            |
| `maxLength` | `value`, a whole number ≥ 1 | The value is text longer than `value`.                                                                                                           |
| `min`       | `value`, a number           | The value, as ECMAScript `Number()` reads it, is NaN or below `value`.                                                                           |
| `max`       | `value`, a number           | The same, above `value`.                                                                                                                         |
| `pattern`   | `value`, text               | The value's text (text itself; a number or boolean as it prints; anything else `''`) does not match `value` as an ECMAScript regular expression. |
| `match`     | `field`, a field name       | The value is not `===` the value of the named field, read from the same scope or an enclosing one.                                               |

Each rule's default message is the host's. Rules are evaluated in order, and every failing rule's
message is kept; the readers below report the first.

**A `pattern` is bounded.** A pattern longer than 200 code units, or one that does not compile, fails
every value, and so does a value longer than 4,096 code units. An implementation MUST NOT run a
pattern without both bounds.

> **Why fail rather than pass.** A rule nobody can satisfy is visible on the first try; a rule that
> silently approves everything is the one that ships. The bounds keep a stranger's pattern from
> pinning the page on a value the same template chose.

**Touched.** Each field has a _touched_ flag, false at mount, set by `$touch`
([Handlers](handlers.md#touch)) and cleared by `$resetLocal` and by a reactive initial re-seeding the
field. The readers are functions in the template's library:

| Function         | Answers                                                                                |
| ---------------- | -------------------------------------------------------------------------------------- |
| `error(field)`   | The first failing rule's message once the field is touched, else `''`.                 |
| `valid(field)`   | Whether every rule passes, touched or not. `true` for a field with no rules.           |
| `touched(field)` | The touched flag.                                                                      |
| `formValid()`    | Whether every field of the nearest enclosing `$localState` scope passes all its rules. |

`field` is a field name as text, and a validator holds it to the fields in scope, as it does
`local.<name>`.

---

Implemented by: [`validation.ts`](../../../packages/schema-system/shared/src/validation.ts)
(`validateField`), [`formFunctions.ts`](../../../packages/schema-system/shared/src/formFunctions.ts),
[`local.ts`](../../../packages/schema-system/shared/src/propResolvers/local.ts) (`$touch`,
`$resetLocal`).
Pinned by: [`validation.test.ts`](../../../packages/schema-system/shared/tests/validation.test.ts);
render vector `render.local.validation`; function vectors for `error`, `valid`, `touched`,
`formValid` in `functions.json`.
