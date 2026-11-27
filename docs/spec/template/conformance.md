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
| `validate.json`       | validate       | a document → whether it is valid, and the path of each error                                       | format            |
| `safety.json`         | safety         | a template, its grants and a script of events → the drawn tree, actions fired and confirmations    | format            |
| `panels.json`         | panels         | panel declarations and an address → the panels present; a panel's three rungs → its placement      | format            |
| `rdf.json`            | rdf            | a template → the triples it denotes through the [JSON-LD context](rdf.md), as canonical N-Quads    | format            |
| `style.json`          | style          | design-system props and a theme → the style emitted and each token's value                         | core catalog      |
| `tokens/<theme>.json` | tokens         | a theme → every token's computed value                                                             | core catalog      |
| `host-functions.json` | host-functions | a host function and its options → value                                                            | WE's host catalog |
| `query/query.json`    | query          | entity schemas, a dataset and a query → the rows it answers with; after writes, for a live case    | backend           |

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

**expressions.** A case is `{ id, note, core, source, env?, result, print }`, or
`{ id, note, core, source, env?, error: "syntax", message, span }` for a source that must not parse. `env`
names an entry of the file's `envs`, an object of root name to value: a root is bound when it is a
key, and unbound otherwise. Parse `source` and evaluate it in that environment, where a call goes to
the core library and the form readers first, and then to the environment's host functions, called
with their first argument as the options object. Compare the value with `result`, and the printed
form of the parse with `print` (printing what was parsed reproduces it). For an error case, compare
only that the source is refused; `message` and `span` are informative.

`core` says whether the case is in the core subset an operation's expressions are written in
([Operations: Expressions](../operations/expressions.md)): `true` for a case of the grammar, of
evaluation or of the printer over no env or plain names, calling only core functions. A host that
runs operations and no templates runs the `core` cases only, as the operations suite says
([The core-subset expression vectors](../operations/conformance.md#the-core-subset-expression-vectors));
a template host runs every case.

**functions.** `{ id, note, core, fn, args, context?, result }`: call `fn` with the decoded `args`
and compare with `result`. `core` is `true` for a core function called with no `context`, the cases
an operations-only host runs. `context` supplies the local-state scope the form readers read. An
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

**validate.** `{ id, note, document, valid, errors }`. Judge `document` as a whole: a template (it
has `meta`) or, without `meta`, a node on its own. `errors` lists each error as `{ at, message }`,
where `at` is the path from the document's root as a list of segments (keys as text, list positions
as numbers) — the position in the document as [expanded](nodes.md#shared-shapes-defs-and-ref), so a
mistake inside a shape is reported at every use. Compare `valid`, and the **set** of `at` paths
(duplicates and order do not count); `message` is informative, and warnings are not recorded,
since what a validator advises is its own. The cases name only the core catalog's vocabulary.

**safety.** A render case (below) with `grants`, the [capability groups](safety.md#capability-grants)
the template is granted, and `confirm`, the person's answer to every confirmation the host asks
(default: declined). The template is drawn through the host's bag: a member outside the grant is
absent, a write nobody asked for is refused, a destructive action asks first. Each `expect` entry
also lists `confirmations`, the destructive actions the host asked about during that step, as
`{ "call", "args" }`. The members the cases name are WE's catalog's; a host maps them onto its own
members of the same group and kind.

**rdf.** `{ id, note, template, nquads }`. Read `template` as RDF with [`context.jsonld`](context.jsonld)
and canonicalize the result; `nquads` is each statement, one a line, sorted. Compare the statements,
then read them back as JSON ([Lossless both ways](rdf.md#lossless-both-ways)) and compare with
`template` as JSON values.

**panels.** `{ id, note, op, … }`. `op: "active"`: given the interface's declarations `shell`, the
section's `view`, the app's `app` and the address as `segments`, `present` lists the panels on the
screen, by id (and title, where the case gives one), in order. `op: "placement"`: given a panel's
own bid `request` (`{ id, edge, size, float }`), the template's `declared` entry, the reader's
`disposition` and a `viewport`, `placement` is where the panel is ([Three rungs](panels.md#three-rungs)).
Compare the placement's `snap`, `displace`, `order`, `band`, `tab` and `home` exactly; its pixel
sizes are WE's host's, which another host compares only if it uses the same size table.

**style, tokens.** The design system's catalog: `{ id, props, theme, direction, style, resolved }`,
the style a component's props emit under a theme, and each prop's token and computed value from
`tokens/<theme>.json`. Recorded in a browser; a host that provides the core catalog runs them.

**host-functions.** `{ id, note, fn, options, result }`: WE's host functions, called with one
options object. A host that provides WE's host catalog runs them; no other host has to.

**query.** The backend's family, in [`@we/backend-conformance`](../../../packages/backend-system/conformance/src/queryVectors.ts)
rather than beside the others, and written by hand rather than recorded: it is the
[query semantics](query.md) as cases. The file is `{ version, invoker, entities, dataset, cases }`:
self-contained entity schemas, the records to write (each created with its id, then its to-many
relations set), and the agent that writes them, put wherever a query names it. A case is
`{ id, level, note, query, expect, pending?, then? }`. `level` is one of `core`, `traversal`,
`aggregates`, `live`, `provenance`, and the id starts `query.<level>.`; `pending` names an open
question the case records WE's answer to. Ask `query` as a host asks a template's (with every
expression already a value) and compare with `expect`: `{ refused: true }`, `{ notAsked: true }`
(a falsy `when`), `{ count, contains? }`, or `{ rows, ordered?, inOrder? }`, the rows by `id`, as a
set unless `ordered`, each naming only the fields it checks (`null` for no value; a nested object
for an included record; a nested list as a set unless its key is in `inOrder`). A live case opens
the query, compares its first snapshot (flagged initial) with `expect`, makes the writes in
`then.writes`, and compares the latest snapshot (not initial) with `then.expect`.

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

| Class                                            | Runs                                                                                                           |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| [Validator](README.md#conformance-classes)       | `validate`, and `expressions.json`'s syntax-error cases. A validator reading templates as RDF also runs `rdf`. |
| [Static renderer](README.md#conformance-classes) | `expressions`, `functions`, `paths`, `query-compile`, and the mount entry of every `render` case.              |
| [Renderer](README.md#conformance-classes)        | The format families: `expressions`, `functions`, `paths`, `navigation`, `query-compile`, `render`.             |
| [Host](README.md#conformance-classes)            | As a renderer, and `safety` and `panels`: the refusals and the panel resolution a host makes.                  |
| A host providing the core catalog                | Also `style` and `tokens`.                                                                                     |
| A backend                                        | `query`: the cases of the levels it implements, its known gaps listed and run inverted.                        |

The render family has a case for every block type (`$each`, `$if`, `$single`, `$animate`, `$routes`,
`$surface`, `$slot`, `$part`, `$panels`, `$agent`, `$ref`) and every handler (`$invoke`,
`$setLocal`, `$toggleLocal`, `$toggleLocalIn`, `$callLocal`, `$touch`, `$resetLocal`, handler `$if`,
and the three lifecycle callbacks), which a coverage test holds it to. The expression and function
families are held to every operator and every function the shipped bundle uses. The validate family
is held to a case for every refusal the format names (each version refusal, the structural ones,
`$if` children, a template `$slot`, `$resetLocal`, a token in children, an unknown radius, a missing
or cyclic `$ref`, `$defs` off the root); the safety family to cases refused and allowed for grants,
gestures and confirmation, with the renderer's element and URL refusals in `render`; the panels
family to both questions and every rung; the query family to a case for every key, operator,
combinator and option [the query semantics](query.md) list.

## What the vectors do not yet carry

> **Planned.** `$single` and `$queries` with an answer, which need a data source; transition timing;
> themes on nodes. The protected pieces stay pinned by the host's own tests: they are host chrome a
> template cannot name, and drawing them needs the host.

---

Implemented by: [`@we/template-conformance`](../../../packages/schema-system/conformance/README.md):
[`src/cases/`](../../../packages/schema-system/conformance/src/cases/) (the cases),
[`encode.ts`](../../../packages/schema-system/conformance/src/encode.ts) (the value markers),
[`renderRecorder.tsx`](../../../packages/schema-system/conformance/tests/support/renderRecorder.tsx)
(recording render and safety vectors through the real renderer and the host's bag),
[`record.ts`](../../../packages/schema-system/conformance/src/record.ts) (the other families,
`validate` and `panels` included).
The vectors: [`vectors/`](../../../packages/schema-system/conformance/vectors/).
Pinned by: [`vectors.test.ts`](../../../packages/schema-system/conformance/tests/vectors.test.ts) and
[`render.test.tsx`](../../../packages/schema-system/conformance/tests/render.test.tsx) (re-recording
in memory against the committed files),
[`coverage.test.ts`](../../../packages/schema-system/conformance/tests/coverage.test.ts); the query
family by [`queryVectors.test.ts`](../../../packages/backend-system/inmemory/tests/queryVectors.test.ts)
(every case from the file alone, and its coverage of `query.md`) and every backend's conformance
suite.
