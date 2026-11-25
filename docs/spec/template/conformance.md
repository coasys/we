# Template format: conformance

The template suite is a set of **vector families**: language-neutral JSON files, each a list of
cases giving an input and what a conforming implementation produces from it. The cases are written
by hand; the outputs are recorded on the reference implementation and re-recorded only on purpose,
so a changed output is a changed contract. The vectors are authoritative where this prose and they
disagree ([Conventions](../README.md#conventions)).

## The files

Every file is `{ "version": 1, "cases": [ … ] }`, with `version` the file's own format version.
Every case carries `id`, unique in its file and stable (**case ids are append-only**: a case is
never renamed or reused), and `note`, one line saying what it pins.

| File                  | Family         | Input → output                                                                                     | Kind              |
| --------------------- | -------------- | -------------------------------------------------------------------------------------------------- | ----------------- |
| `expressions.json`    | expressions    | source and an environment → value, the printed form, or a syntax error                             | format            |
| `functions.json`      | functions      | a function name and arguments → value                                                              | format            |
| `paths.json`          | paths          | a path, the address on screen and the node's base → the address it leads to                        | format            |
| `navigation.json`     | navigation     | a script of navigations and local-state writes → the address and history after each                | format            |
| `query-compile.json`  | query-compile  | a `$query`, a where-object or a scope → its descriptor, its pruned form, or whether it is anchored | format            |
| `render.json`         | render         | a template, data and a script of events → the drawn tree and the actions fired, after each         | format            |
| `style.json`          | style          | design-system props and a theme → the style emitted and each token's value                         | core catalog      |
| `tokens/<theme>.json` | tokens         | a theme → every token's computed value                                                             | core catalog      |
| `host-functions.json` | host-functions | a host function and its options → value                                                            | WE's host catalog |

### Values

Values that JSON cannot carry are written as single-key marker objects, decoded before use:

| Encoded                     | Decoded                                    |
| --------------------------- | ------------------------------------------ |
| `{ "$undefined": true }`    | no value                                   |
| `{ "$nan": true }`          | NaN                                        |
| `{ "$number": "Infinity" }` | +∞ (`"-Infinity"` for −∞)                  |
| `{ "$callable": "<name>" }` | a function (the name is informative)       |
| `{ "$namespace": { … } }`   | a namespace whose members are the object's |
| `{ "$namespace": true }`    | an opaque namespace (in an output only)    |

Everything else is its JSON self. No value and `null` are different values.

### Comparing

An output is compared with the recorded one as JSON values after decoding: the same kind, equal
numbers (NaN equal to NaN), equal text, lists equal entry by entry in order, and objects with the
same keys holding equal values. An implementation conforms to a family when every case of it
matches.

An implementation that does not yet pass a case SHOULD list it, by id, as a known gap, and run it
inverted, so a gap that closes is noticed and a new failure is not hidden among the old ones.

## Running each family

**expressions.** A case is `{ id, note, source, env?, result, print }`, or
`{ id, note, source, env?, error: "syntax", message, span }` for a source that must not parse. `env`
names an entry of the file's `envs`, an object of root name to value: a root is bound when it is a
key, and unbound otherwise. Parse `source` and evaluate it in that environment, where a call goes to
the core library and the form readers first, and then to the environment's host functions, called
with their first argument as the options object. Compare the value with `result`, and the printed
form of the parse with `print` (printing what was parsed reproduces it). For an error case, compare
only that the source is refused; `message` and `span` are informative.

**functions.** `{ id, note, fn, args, context?, result }`: call `fn` with the decoded `args` and
compare with `result`. `context` supplies the local-state scope the form readers read. An
implementation that throws records `{ "$error": "<message>" }`, which only a reference
implementation should ever produce.

**paths.** `{ id, note, to, current, base: { depth, root }, result, relative }`: `result` is where
`to` leads from the address `current`, for a node whose route spans the first `depth` segments of
the address, in a template whose root spans the first `root`
([Relative paths](routing.md#relative-paths)); `relative` is whether `to` is relative at all.

**navigation.** `{ id, note, schema, start, steps, expect }`. Open the address `start`, then run
each step against the host's navigation: `open { href }`, `navigate { to, options? }`,
`set_param { name, value, push? }`, `sync_param { name, value, initial, type, push?, persist? }`
(a `$localState` write with `syncParam`), `local_read { name, persist?, initial, type }` (a field's
value on mount), `back`, `forward`. After each, compare `{ href, pageIdentity, depth, index,
resolved? }`: the address as path, query and hash; the page's identity (its path and its `id` query
value); the script's own history depth and position; and, for `local_read`, the value it read. The
path and local-state rules these pin are the format's; the operations are the
[navigation profile](../profiles/members.md#navigation)'s, which a host maps onto its own router.

**query-compile.** `{ id, note, op, … }`: `op: "query"` resolves `query` to `descriptor` (entity,
params, subscribe, dataset, include, when); `op: "where"` prunes `where` to `pruned`
([Unresolved operands](query.md#unresolved-operands-and-when)); `op: "scope"` decides whether `scope`
is still `anchored`.

**render.** See [below](#render).

**style, tokens.** The design system's catalog: `{ id, props, theme, direction, style, resolved }`,
the style a component's props emit under a theme, and each prop's token and computed value from
`tokens/<theme>.json`. Recorded in a browser; a host that provides the core catalog runs them.

**host-functions.** `{ id, note, fn, options, result }`: WE's host functions, called with one
options object. A host that provides WE's host catalog runs them; no other host has to.

## Render

A case is `{ id, note, template, data?, actions?, gated?, params?, storage?, identities?, start?,
steps?, expect }`:

| Key          | Value                                                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `template`   | The root node. A template with `routes` is drawn under a router opened at `start` (default `/`); any other is drawn alone.                                                                                         |
| `data`       | Store members the template reads, `{ store: { member: value } }`, held reactively.                                                                                                                                 |
| `actions`    | Store actions the template calls, `{ "store.method": outcome }`: `{ "resolve": v }` a promise resolving `v`, `{ "reject": m }` one rejecting with an error whose message is `m`, `{ "returns": v }` a plain value. |
| `gated`      | The actions the host refuses without a [gesture](safety.md#gestures).                                                                                                                                              |
| `params`     | The URL query parameters at mount, for `syncParam`.                                                                                                                                                                |
| `storage`    | Device storage at mount, for `persist`, by full key.                                                                                                                                                               |
| `identities` | The profiles the host can answer for `$agent`, by identifier.                                                                                                                                                      |
| `steps`      | The script, run in order.                                                                                                                                                                                          |

Steps:

- `{ "op": "click", "target" }` — a press on the element whose `data-case` prop is `target`. A gesture.
- `{ "op": "input", "target", "value" }` — typing: the element's value set and an `input` event. A gesture.
- `{ "op": "emit", "target", "event", "detail"? }` — an event the element fires by itself. Not a
  gesture, unless `event` is an activation event (`change`, `input`).
- `{ "op": "navigate", "to" }` — the router moves to `to`.
- `{ "op": "data", "store", "member", "value" }` — a store member changes.

`expect` holds one entry for the mount and one after each step: `{ tree, actions, params?, storage? }`.
`actions` is the list of actions called during that step, in order, each `{ "call", "args" }`;
`params` and `storage` are the URL parameters and stored entries after it, where the case reads
them. Let every promise settle before reading an entry.

### Render trees

`tree` is a list of what the template drew, **renderer-neutral**:

- a node is `{ "type", "props"?, "slot"?, "children"? }`: `type` as the template wrote it, `props`
  what the renderer handed the component or element (with every token resolved, and handlers left
  out, since their effect is in `actions`), `children` what it drew inside;
- a named slot a component received is `{ "slot", "children" }`;
- text is a string;
- the [missing marker](degradation-and-versioning.md#the-missing-marker) is
  `{ "missing": "<type>", "reason": "<reason>" }`;
- a responsive boundary is `{ "type": "$surface", "children" }`.

Block types other than `$surface` leave no entry of their own: what they draw stands in their place.
Boxes a renderer adds for its own reasons (a wrapper carrying a theme, a frame with no box) are left
out. The layout components the cases use (`Column`, `Row`, `Card`, `Grid`, and the host's
`PartFrame` and `PanelLane`) are **probes**: they draw only their props and children, since what a
component does with its props is the component's contract, not the format's. A custom element is a
real element of that name whose set properties are read back.

A **static renderer** compares only the first entry of each case's `expect`.

## Which families a class runs

| Class                                            | Runs                                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| [Validator](README.md#conformance-classes)       | `expressions.json`'s syntax-error cases. The rest of what a validator does is pinned by tests, not yet by vectors. |
| [Static renderer](README.md#conformance-classes) | `expressions`, `functions`, `paths`, `query-compile`, and the mount entry of every `render` case.                  |
| [Renderer](README.md#conformance-classes)        | The format families: `expressions`, `functions`, `paths`, `navigation`, `query-compile`, `render`.                 |
| [Host](README.md#conformance-classes)            | As a renderer, and the [safety](safety.md) refusals.                                                               |
| A host providing the core catalog                | Also `style` and `tokens`.                                                                                         |

The render family has a case for every block type (`$each`, `$if`, `$single`, `$animate`, `$routes`,
`$surface`, `$slot`, `$part`, `$panels`, `$agent`, `$ref`) and every handler (`$invoke`,
`$setLocal`, `$toggleLocal`, `$toggleLocalIn`, `$callLocal`, `$touch`, `$resetLocal`, handler `$if`,
and the three lifecycle callbacks), which a coverage test holds it to. The expression and function
families are held to every operator and every function the shipped bundle uses.

## What the vectors do not yet carry

> **Planned.** Validator vectors (a document in, valid or the error paths out); `$single` and
> `$queries` with an answer, which need a data source; transition timing; themes on nodes; the
> safety refusals of a host as vectors rather than tests of WE's own; panel resolution.

---

Implemented by: [`@we/template-conformance`](../../../packages/schema-system/conformance/README.md):
[`src/cases/`](../../../packages/schema-system/conformance/src/cases/) (the cases),
[`encode.ts`](../../../packages/schema-system/conformance/src/encode.ts) (the value markers),
[`renderRecorder.tsx`](../../../packages/schema-system/conformance/tests/support/renderRecorder.tsx)
(recording render vectors through the real renderer).
The vectors: [`vectors/`](../../../packages/schema-system/conformance/vectors/).
Pinned by: [`vectors.test.ts`](../../../packages/schema-system/conformance/tests/vectors.test.ts) and
[`render.test.tsx`](../../../packages/schema-system/conformance/tests/render.test.tsx) (re-recording
in memory against the committed files),
[`coverage.test.ts`](../../../packages/schema-system/conformance/tests/coverage.test.ts).
