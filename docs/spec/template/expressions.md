# Template format: the expression language

Every computed value in a template is an expression, a string in a `{ "$": "…" }` token. The
template language is the **operations subset** ([Operations: the expression subset](../operations/expressions.md))
with more names to read and more functions to call. Everything that file says holds here unchanged:
the values, truthiness, conversions, the grammar, the evaluation of every form, comprehensions, the
where-object and the core function library. This file says only what a template adds.

An expression valid in an operation means the same in a template, given the same names.

## What is the same

So that a renderer implementer can find them in one place, the rules the subset fixes and a template
inherits, each specified there:

- **The grammar** ([Grammar](../operations/expressions.md#grammar)), with its precedence, loosest
  first: `?:`, `??`, `||`, `&&`, `== !=`, `< > <= >= in`, `+ -`, `* / %`, unary `! -`, then member,
  index and call. No assignment, no statement, no function definition, no method call. **No syntax
  is added in minor versions**, here as there.
- **Totality** ([Evaluation](../operations/expressions.md#evaluation)): no expression that parses
  fails at run time, and wrong-typed input gives the empty value of its kind.
- **`&&` and `||` answer with a boolean**, never with an operand: `a && b` is `false` when `a` is
  falsy, else whether `b` is truthy; `a || b` is `true` when `a` is truthy, else whether `b` is
  truthy. The value-picking idiom is `??`.
- **Division and remainder by zero are `0`.**
- **Numbers** ([Conversions](../operations/expressions.md#conversions)): a value reads as a number
  when it is a finite number or text that is wholly a decimal numeral; arithmetic reads anything
  else as `0`, a missing operand included; `+` joins text when either side is text; and no number
  the language produces is `-0`.
- **Comparison** with `<`, `<=`, `>`, `>=`: as numbers when both sides read as numbers, by Unicode
  code point when both are text, and `false` otherwise.
- **`contains`** ignores case, as the where-object's `contains` does; **`startsWith` and `endsWith`**
  compare exactly.
- **`min` and `max`** take the numbers given, or the entries of a single list argument; a list among
  several arguments reads as `0`; no values gives `0`.
- **Objects and clears**: a key holding `null` is a field and is kept by `put`, `merge`, `keys` and
  `values`; only a key with no value is left out.

### Truthiness

As the subset's ([Truthiness](../operations/expressions.md#truthiness)): **no value, `null`, `false`,
`0`, NaN and `''` are falsy; everything else is truthy, including `[]`, `{}` and `'0'`.** A namespace
(a store, `local`) read as a value is no value, and so is falsy ([Namespaces](#namespaces)).
Truthiness decides `!`, `&&`, `||`, `?:`, the comprehensions, a node-level `$if`, a handler `$if`,
`$animate`'s `condition` and a query's `when`.

---

Implemented by: [`lexer.ts`](../../../packages/schema-system/expressions/src/lexer.ts),
[`parser.ts`](../../../packages/schema-system/expressions/src/parser.ts),
[`evaluate.ts`](../../../packages/schema-system/expressions/src/evaluate.ts),
[`functions.ts`](../../../packages/schema-system/expressions/src/functions.ts).
Pinned by: `expressions.json` (families `eval`, `op`, `print`, `bundle`) and `functions.json`
([Conformance](conformance.md)); render vector `render.if.absent`.

## Names

An operation's names are fixed before it runs; a template's come from where the expression stands. A
root name is looked up in this order, the first that answers winning:

1. **`local`** — a [namespace](#namespaces) over the `$localState` fields and `$queries` results in
   scope, nearest first ([Local state](handlers.md#local-state)).
2. **A name the context binds** — `$each`'s item, `index` and `prev`; `$single`'s, `$agent`'s and
   `$surface`'s `as` names; a `$part`'s inputs; and, inside a handler, the call-time roots.
3. **A host value** the host provides by name. In this version: `me`, the person viewing, and
   `currentDataset`, the dataset on screen. What each holds is a profile's
   ([Catalogs](catalogs.md#profiles)).
4. **A store** in the bag — a [namespace](#namespaces) over its granted members — including
   `modules`, whose members are the module stores by module id.

A name nothing answers is no value. A validator MUST report every name it cannot resolve in a
template, with its column, unless the expression stands in a fragment judged alone (whose names are
supplied by whatever composes it). A renderer MUST NOT fail on one.

A name a template binds shadows a store or a namespace of the same name, as it does at run time:
under `$each` with `as: "record"`, `record.title` is the row's field. A validator SHOULD warn where a
bound name hides a namespace whose member is then read under it (`as: "layout"`, then
`layout.collapsedLanes`), since that read finds the row's field and not the member.

### Call-time roots

`event`, `arg` and `result` are bound only while a handler runs: `event` (and `arg`, an older
spelling of it) to the first argument the handler was called with, `result` inside a lifecycle
callback to what the action settled with ([`$invoke`](handlers.md#invoke)). Where they may be written
is in [Render time and call time](values.md#render-time-and-call-time).

A call-time value is read through the same rule as every other value ([Reach](#reach)): its fields
are data. A function found on it may be **kept**, as a value a `$setLocal` stores in a `function`
field, which is how a component hands a template something to call later
([`$callLocal`](handlers.md#calllocal)). It cannot be called from an expression.

### Namespaces

A store, a profile's namespace ([Capability profiles](../profiles/README.md)) and `local` are
namespaces: values whose members are read with `.` (or `[ ]`) and which are not values themselves. A namespace read as a whole (`spaceStore`, or `local` alone) is no value. A
store member the bag does not grant is no value ([Capability grants](safety.md#capability-grants)),
exactly as an unknown member is. A store's actions are not readable: `spaceStore.createPost` read in
an expression is no value, and only `$invoke` calls it.

### Reach

An expression reads data and nothing else:

- A member read on an object gives its own value under that name. `__proto__`, `constructor` and
  `prototype` are refused as names, as in the subset.
- A function met on the way is no value, unless it is a reactive accessor (a store's state, a local
  field), which is read, or a function a callback handed over, which is kept as above.
- A host object that is not data (a page element, a window, a storage object) answers only the few
  fields a host lists for it (an event's key and detail, its target's value) and no value for
  anything else.

An expression has no way to run anything: there is no method call, and `x.f(y)` is the library
function `f(x, y)`.

---

Implemented by: [`expression.ts`](../../../packages/schema-system/shared/src/propResolvers/expression.ts)
(`buildEnvironment`), [`evaluate.ts`](../../../packages/schema-system/expressions/src/evaluate.ts)
(`readValue`, `callbackValue`, `NAMESPACE`), [`reach.ts`](../../../packages/schema-system/expressions/src/reach.ts),
[`check.ts`](../../../packages/schema-system/expressions/src/check.ts) (`checkExpression`).
Pinned by: `expressions.json` family `env`; [`reach.test.ts`](../../../packages/schema-system/expressions/src/reach.test.ts);
render vectors `render.degrade.failing-expression`, `render.handler.call-local`.

## Functions

A call `f(…)` or `x.f(…)` is looked up in this order:

1. **The core library** ([Core functions](../operations/expressions.md#core-functions)). Every host
   provides it, with exactly the behaviour given there, and no host may replace one of its names.
2. **The form readers** `error`, `valid`, `touched` and `formValid`
   ([Validation rules](values.md#validation-rules)), which read the local-state scope rather than
   their arguments alone. Every renderer provides them.
3. **Host functions**, which a host registers by name ([Host functions](#host-functions)).

A name none of these answers is no value at run time, and a validator MUST report it. A wrong number
of arguments to a core function or a form reader is an error a validator reports; at run time the
missing arguments are no value and the extra ones are ignored.

### Host functions

A host function is computation a host provides that the library does not: a calendar's month as rows,
what a set of reactions tallies to. It is called with **one argument, an options object**, by
convention: `calendarMonth({ offset: local.monthOffset, weekStartsOn: 1 })`. Its options are named,
so adding one is additive. It MUST be pure and total as a core function is: no effect, and no error
for bad input (an implementation that throws gives no value).

Which host functions exist, and what each answers, is a catalog's ([Catalogs](catalogs.md)), never
this spec's. A template that calls one depends on a host that provides it; on a host that does not,
the call is no value and the template degrades with it.

> **Why one object.** A host function's options grow as hosts find uses for it, and a positional
> argument list cannot grow without changing what an existing call means.

---

Implemented by: [`functions.ts`](../../../packages/schema-system/expressions/src/functions.ts)
(`defineFunction`, `CORE_FUNCTIONS`), [`formFunctions.ts`](../../../packages/schema-system/shared/src/formFunctions.ts),
[`expression.ts`](../../../packages/schema-system/shared/src/propResolvers/expression.ts) (`call`).
Pinned by: [`expressions.test.ts`](../../../packages/schema-system/expressions/src/expressions.test.ts)
("the core subset"); `functions.json`; `host-functions.json` for WE's host catalog.

## Errors

- **A parse error** in a stored template draws no value where the expression stands and does not
  stop the rest of the tree. A validator reports it with its column.
- **A limit** ([Grammar](../operations/expressions.md#grammar)): an implementation MAY refuse an
  expression longer than 4,000 UTF-16 code units or nested deeper than 40 levels, and MUST accept
  anything within both. A refused expression is a parse error.

---

Implemented by: [`parser.ts`](../../../packages/schema-system/expressions/src/parser.ts),
[`semanticValidation.ts`](../../../packages/schema-system/shared/src/semanticValidation.ts).
Pinned by: expression vector `op.too-deep`; validate vector `validate.expression.syntax`; [`expressions.test.ts`](../../../packages/schema-system/expressions/src/expressions.test.ts)
(the column of a syntax error).

## Planned

> **Planned.** The expressivity ladder adds named functions a template defines for itself and
> declared rules over its records. Neither is in this version: a key for them on a node is invalid,
> and no syntax will be added to express them.

> **Planned.** Versioned host-function catalogs, so a template can say which it needs and a host can
> refuse what it does not provide before rendering ([Catalogs](catalogs.md)).
