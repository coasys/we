# Expressions

An **expression** is a prop or child value `{ $: '<source>' }`. It computes a value from stores, local state and bound names with one closed grammar: literals, references, comparison, boolean and arithmetic operators, string interpolation, a ternary, and five comprehension macros (`filter`, `map`, `find`, `exists`, `all`). New capability goes into the function library, not the grammar.

**Why:** With a closed grammar, an author, the validator and the AI context learn one language that does not grow. Each new computation is a catalogued function in the library (`ast.ts`). An expression cannot define functions, recurse or call a value's own methods (`a.f(b)` means the library call `f(a, b)`), so evaluation is total. Every node carries a `span`, so the checker can name a column.

**Parent:** [Schema language](README.md)

<details><summary>How it works</summary>

1. `parseCached` parses the source once. A parse error resolves to `undefined` and warns once.
2. `buildEnvironment` binds the roots in this order: `local` (the node's `$localState` and `$queries`), a context name (a `$each` variable, `event`, `result`, `surface`), `arg`, a host global (`me`, `currentDataset`), then a store of the **template bag**.
3. `evaluateExpression` runs inside one framework memo, so each tagged store read is a tracked dependency ([Renderer](../renderer/README.md)).
4. An expression that names `event`, `arg` or `result` (`CALL_TIME_ROOTS`) outside a handler becomes a deferred function. The `$invoke` dispatcher calls it with the callback's argument.
5. A call goes to the library (`getFunction`) first, then to a **host source** in the bag's `$sources` (for example `arrangedBoard`, `calendarMonth`), else it warns.

Property reads go through `readField` (`reach.ts`). Data reads as usual. A host object (an `Event`, a DOM `Node`, `Storage`, …) gives only the fields listed for its kind. The parser refuses `__proto__`, `constructor` and `prototype`. The where-object grammar of `$query` and of `filter`/`find` is one implementation (`where.ts`).

</details>

<details><summary>Where in the code</summary>

- [expressions/](../../../packages/schema-system/shared/src/expressions): [ast.ts](../../../packages/schema-system/shared/src/expressions/ast.ts) (`Expr`, `MacroName`, `CALL_TIME_ROOTS`), [lexer.ts](../../../packages/schema-system/shared/src/expressions/lexer.ts), [parser.ts](../../../packages/schema-system/shared/src/expressions/parser.ts), [evaluate.ts](../../../packages/schema-system/shared/src/expressions/evaluate.ts) (`evaluateExpression`), [check.ts](../../../packages/schema-system/shared/src/expressions/check.ts) (`checkExpression`), [reach.ts](../../../packages/schema-system/shared/src/expressions/reach.ts) (`readField`), [where.ts](../../../packages/schema-system/shared/src/expressions/where.ts), [printer.ts](../../../packages/schema-system/shared/src/expressions/printer.ts).
- [functions.ts](../../../packages/schema-system/shared/src/expressions/functions.ts): `defineFunction`, `getFunction`. A function defined here reaches the validator, the evaluator and the generated AI context.
- [propResolvers/expression.ts](../../../packages/schema-system/shared/src/propResolvers/expression.ts): `resolveExpressionProp`, `buildEnvironment`, `DEFERRED_ARG`.
- [packages/app-shell/src/shared/sources/index.ts](../../../packages/app-shell/src/shared/sources/index.ts): the host sources and their catalogue entries.
- [packages/schema-system/CONVENTIONS.md](../../../packages/schema-system/CONVENTIONS.md): "Adding a function".

</details>
