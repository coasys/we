# Template format: handlers and local state

Handlers are what a template does: a closed set of verbs, each a token, run when an element fires an
event. Local state is the template's own memory, declared on a node and written only by handlers.

## Event props

A prop whose name is `on` followed by an upper-case letter (`onClick`, `onInput`, `onSelect`) is an
**event prop**. Its value is a handler token or a list of them. On an element the renderer binds it
to the event named by the rest of the prop's name in lower case (`onClick` is `click`,
`onOpenChange` is `openchange`); to a component it is handed as a callback under its own name.

- **A list** runs its entries in order, each resolved when the event fires, so a `$if` in it reads
  state as it is then.
- **The event** is the first argument the element or component called the handler with, bound as
  `event` for every expression the handler evaluates.
- A handler never passes the event on by itself: an action gets only the arguments written
  ([`$invoke`](#invoke)).

Whether a handler may run at all depends on who caused the event ([Gestures](safety.md#gestures)).

## The handler tokens

| Token                              | Does                                                            |
| ---------------------------------- | --------------------------------------------------------------- |
| [`$invoke`](#invoke)               | Calls an action in the bag, with lifecycle callbacks.           |
| [`$setLocal`](#setlocal)           | Sets a local field to a value, or merges into an object field.  |
| [`$toggleLocal`](#togglelocal)     | Flips a boolean field.                                          |
| [`$toggleLocalIn`](#togglelocalin) | Adds a value to a list field, or removes it.                    |
| [`$callLocal`](#calllocal)         | Calls the function a `function` field holds.                    |
| [`$touch`](#touch)                 | Marks a field, or every field of the scope, as touched.         |
| [`$resetLocal`](#resetlocal)       | Puts every field of the scope back to its initial value.        |
| [`$if`](#handler-if)               | Runs one handler or another, by a condition read when it fires. |

Each token is closed: it carries the keys given for it and no others. A handler that names a local
field the scope does not declare does nothing, and a validator reports it.

---

Implemented by: [`dispatcher.ts`](../../../packages/schema-system/shared/src/propResolvers/dispatcher.ts),
[`local.ts`](../../../packages/schema-system/shared/src/propResolvers/local.ts),
[`zodSchemas.ts`](../../../packages/schema-system/shared/src/zodSchemas.ts) (`zPropToken`).
Pinned by: render vector `render.handler.array`;
[`semanticValidation.test.ts`](../../../packages/schema-system/shared/tests/semanticValidation.test.ts).

## `$invoke`

```json
{
  "$invoke": "record.update",
  "args": ["TaskBlock", { "$": "task.id" }, { "status": "done" }],
  "onSuccess": [{ "$setLocal": "editing", "value": false }]
}
```

`$invoke` is a dot path into the bag: every segment but the last walks to an object, and the last
names the action on it (`modules.notes.toggle` is the action `toggle` of `modules.notes`). The
action is **called with exactly `args`**, each resolved when the handler fires, and with no arguments
when there is no `args`.

- An `args` entry that is an expression reading `event`, `arg` or `result` is evaluated with the
  event bound; any other value is resolved as values are ([Values](values.md)). Reactive values are
  read: the action receives plain values.
- A path naming nothing in the bag (no such store, no such action, or one the bag does not grant)
  does nothing, and nothing else breaks. A validator reports an unknown store or action.

**Lifecycle callbacks.** `onSuccess`, `onError` and `onFinally` are lists of handlers. When the
action answers with a promise, `onSuccess` runs after it resolves, with `result` bound to the value,
or `onError` after it rejects, with `result` bound to the error (its `message` readable); `onFinally`
runs after either. When the action answers with anything other than a promise, no callback runs.
Callbacks run as part of the gesture that started the call ([Gestures](safety.md#gestures)).

What actions exist, what they take and what they answer are the bag's: the host's
[profiles](../profiles/README.md) and the modules' stores ([Catalogs](catalogs.md)). Two families of action are neutral and specified
elsewhere: `record.create`, `record.update` and `record.delete`, which write one record of the data
model, and `ops.<namespace>.<name>`, which runs a declared operation
([Operations](../operations/README.md)).

> **Why exactly `args`.** When an `$invoke` without `args` was handed whatever the element emitted,
> every action's signature was coupled, unseen, to every element's event shape: a button's click
> arrived as the first argument of any action with an optional one.

---

Implemented by: [`invoke.ts`](../../../packages/schema-system/shared/src/propResolvers/invoke.ts).
Pinned by: [`invoke.test.ts`](../../../packages/schema-system/shared/src/propResolvers/invoke.test.ts);
render vectors `render.handler.invoke`, `render.handler.invoke-no-args`,
`render.handler.invoke-event-detail`, `render.handler.on-success`, `render.handler.on-error`,
`render.handler.sync-lifecycle`, `render.handler.missing-method`.

## `$setLocal`

```json
{ "$setLocal": "query", "value": { "$": "event.detail" } }
{ "$setLocal": "draft", "merge": { "title": { "$": "event.detail" } } }
```

With `value`: sets the field to the value, evaluated when the handler fires. `value` is a literal
unless it is an expression; any other token object inside a literal is stored as the object it is.
With `merge`: shallow-merges each key's value into an object field, each a literal or an expression.

A `$queries` name cannot be set: the handler does nothing.

Pinned by: render vectors `render.handler.set-local`, `render.handler.set-local-event`,
`render.handler.set-local-merge`.

## `$toggleLocal`

`{ "$toggleLocal": "open" }` sets the field to the negation of its current value's truthiness.

Pinned by: render vector `render.handler.toggle-local`.

## `$toggleLocalIn`

`{ "$toggleLocalIn": "collapsed", "value": { "$": "group.id" } }` reads the field as a list (no value
and `null` as `[]`) and, when it holds an entry equal to `value` (by `==`, with NaN equal to NaN),
writes it back without that entry, otherwise with `value` appended. `value` is REQUIRED and evaluated
when the handler fires. A field holding anything other than a list, no value or `null` is left as it
is.

> **Why.** Field names are fixed when a template is written, so "is this row open" cannot be a
> boolean per row when the rows come from data. The field holds the ids that are on; `in` reads it
> back.

Pinned by: render vectors `render.handler.toggle-local-in`, `render.handler.toggle-local-in-rows`.

## `$callLocal`

`{ "$callLocal": "onConfirm" }` calls the function the named `function` field holds, with the
handler's own arguments, and does nothing when the field holds no function. A template cannot put a
function in a field by itself: only a value a component handed over through an event can fill one
([Call-time roots](expressions.md#call-time-roots)). A call passes on the gesture it runs in and
cannot start one.

Pinned by: render vector `render.handler.call-local`.

## `$touch`

`{ "$touch": "email" }` sets the named field's touched flag ([Validation rules](values.md#validation-rules)).
`{ "$touch": "$all" }` sets every field of the nearest enclosing `$localState` scope.

## `$resetLocal`

`{ "$resetLocal": "$scope" }` puts every field of the nearest enclosing `$localState` scope back to
its declared initial (an expression initial re-evaluated now), clears its touched flag, removes its
stored copy and its URL parameter ([Persistence](#persistence-syncparam-and-persist)). `"$scope"` is
the only value defined in this version: a validator refuses any other, and a renderer that meets
one does nothing.

Pinned by: render vectors `render.handler.reset-local`, `render.handler.reset-local-not-scope`,
`render.local.persist`; [`semanticValidation.test.ts`](../../../packages/schema-system/shared/tests/semanticValidation.test.ts).

## Handler `$if`

```json
{ "$if": { "condition": { "$": "event.key == 'Enter'" }, "then": { … }, "else": [ … ] } }
```

Between handlers, `$if` is a token: `condition` (REQUIRED, an expression or a literal) is read when
the handler fires, with the event bound, and the handler or list in `then` runs when it is truthy,
the one in `else` otherwise. Either side may be absent. It is the only conditional between handlers.

Pinned by: render vectors `render.handler.if-then`, `render.handler.if-event`.

---

Implemented by: [`local.ts`](../../../packages/schema-system/shared/src/propResolvers/local.ts),
[`conditional.ts`](../../../packages/schema-system/shared/src/propResolvers/conditional.ts).

## Local state

```json
"$localState": {
  "search": { "type": "string", "initial": "", "syncParam": "q" },
  "density": { "type": "string", "initial": "comfortable", "persist": "cards.density" },
  "open": { "type": "boolean", "initial": false }
}
```

A node MAY declare `$localState`, an object of field name to declaration:

| Key         | Value                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `type`      | REQUIRED. `string`, `boolean`, `number`, `object`, `array` (a set of values, the type `$toggleLocalIn` writes), `function` or `file`. |
| `initial`   | REQUIRED. A literal (text, number, boolean, `null` or a list) or a token: the value at mount. Text is text, whatever it starts with.  |
| `validate`  | A list of [validation rules](values.md#validation-rules).                                                                             |
| `syncParam` | Mirror the field into a URL query parameter: text naming it, or `{ "name", "push"? }`.                                                |
| `persist`   | Keep the field on the device, under the text given as its key.                                                                        |

The fields are created when the node mounts and are gone when it unmounts. They are readable in the
node's subtree as `local.<name>` (dot paths read into an object field) and written only by handlers.
A nested declaration adds to the fields in scope, and an inner field shadows an outer one of the same
name. A `$localState` inside an `$each` row is that row's own.

**An expression initial** is evaluated at mount, against the context and the bag around the node.
When what it read changes, the field is set to the new value and its touched flag cleared (so a form
seeded from the space on screen follows a change of space).

---

Implemented by: [`SchemaRenderer.tsx`](../../../packages/schema-system/frameworks/solid/src/SchemaRenderer.tsx)
(`$localState`), [`types.ts`](../../../packages/schema-system/shared/src/types.ts) (`LocalStateField`).
Pinned by: render vectors `render.local.initial`, `render.local.initial-expression`,
`render.local.initial-dollar-text`, `render.local.shadowing`, `render.local.per-row`.

### Persistence: `syncParam` and `persist`

Two opt-in mirrors, for two kinds of state:

- **`syncParam`** is for view state, what a link's recipient should see as the sender does: the
  selected tab, a sort, a filter, a search. A write sets the URL query parameter; with `push: true`
  it adds a history entry, and otherwise replaces the current one.
- **`persist`** is for a preference, what a link must not impose: a display density, a collapsed
  rail. A write stores the value on the device under the key `we-local:<persist>`. The key is global
  to the deployment, so two templates naming the same key share the preference.

Neither applies to a `function` or `file` field.

**Encoding.** A `string` field's parameter is its text as it is; any other field's parameter, and
every stored value, is its JSON. Reading a parameter back, a `string` field takes the text, and any
other takes the parsed JSON, or the raw text when it does not parse.

**Clean addresses.** A write that puts the field back at its declared initial (compared as JSON)
removes the parameter.

**On mount**, the field's value is the URL parameter when there is one, else the stored value when
there is one, else the declared initial.

A host without a URL binding treats `syncParam` as plain local state; one without device storage
does the same for `persist`.

> **Why two.** The deciding question for a field is whether the recipient of a link should see its
> effect. If so, it is view state and belongs in the address; if only the person's future self
> should, it is a preference and stays on their device; if nobody, it stays plain.

---

Implemented by: [`localStateSync.ts`](../../../packages/schema-system/shared/src/localStateSync.ts)
(`localSyncSpec`, `localPersistKey`, `encodeLocalParam`, `decodeLocalParam`, `localParamText`,
`resolveLocalInitial`).
Pinned by: [`localStateSync.test.ts`](../../../packages/schema-system/shared/src/localStateSync.test.ts);
render vectors `render.local.sync-param-read`, `render.local.sync-param-write`, `render.local.persist`,
`render.local.precedence`; navigation vectors `nav.sync-json`, `nav.sync-back-at-initial`,
`nav.sync-string-raw`, `nav.sync-push`, `nav.sync-replace`, `nav.local-precedence`,
`nav.local-persisted`.
