# @we/expressions

WE's expression language: the `{ $: '…' }` value layer of a template and the expressions a declared
operation is written in. One closed grammar (`ast.ts` says why it is closed), its lexer, parser and
printer, the static checker, the evaluator, and the function library beneath it.

## What belongs here

**The language, and the functions that mean the same everywhere it runs.**

- the grammar, parser, printer and `parseCached`
- `checkExpression` — column-precise checking against a scope
- `evaluateExpression` — total and inert; `reach.ts` is where a read stops at the page
- `REACTIVE_ACCESSOR` / `markReactive` — the tag the evaluator reads through, shared with the
  renderers
- the where-object adapter over the backend contract's `matchesWhere`
- the core function library and its registry (`defineFunction`, `getFunction`, `listFunctions`,
  `arityOf`), and `CORE_FUNCTIONS`, the names defined here

## What doesn't

**Anything that knows what a rendered template is.** Form state, `$localState`, prop resolution, the
dispatcher: those are `@we/schema-shared`. A function that reads renderer state, or that only one
deployment provides, is registered by the host through `defineFunction` (or as a host source) and
is not core.

The package depends on `@we/backend-shared` and nothing else, so that `@we/entities`, which
depends only on the backend contract, can evaluate an operation's expressions.

## Core and host functions

Every function `functions.ts` defines is core, and a host cannot redefine one. Something that must
evaluate identically on every host — a declared operation — is checked with
`checkExpression(expr, { …scope, functions: 'core' })`, which refuses every other name.
