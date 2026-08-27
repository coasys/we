# Schema System — Design Conventions

Rules and patterns for building and maintaining the schema-driven rendering system (`@we/schema-shared` + `@we/schema-solid`).

## Package Structure

| Directory | Package             | Purpose                                                         |
| --------- | ------------------- | --------------------------------------------------------------- |
| `shared/` | `@we/schema-shared` | Framework-agnostic types, prop resolvers, validators, mutations |
| `solid/`  | `@we/schema-solid`  | SolidJS renderer implementation                                 |

All operator resolution logic lives in `shared/` — the renderer layer (`solid/`) only handles DOM construction and framework-specific reactivity.

## Four Layers, One Grammar

The `$`-constructs a schema writes are four different kinds of thing, and only three of them are
tokens:

| Layer     | Spelling                                                                                                              | Why it is what it is                                                  |
| --------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Structure | Node types `$each`, `$if`, `$routes`, `$animate`, `$single`, `$surface`, `$slot`, `$agent`; `$localState`, `$queries` | Arrangement — what section-level remixing operates on                 |
| Query     | `{ $query }`, `$queries`                                                                                              | An IR the backend pushes down                                         |
| Handlers  | `$action`, `$setLocal`, `$toggleLocal`, `$toggleLocalIn`, `$callLocal`, `$touch`, `$resetLocal`                       | A closed set of verbs; grants and `destructive` flags attach to verbs |
| Values    | `{ $: "count(local.rows) > 0 && local.search != ''" }`                                                                | One expression language — closed grammar, open function library       |

The value layer lives in `shared/src/expressions/`: `ast.ts` (the grammar and why it is closed),
`lexer.ts`/`parser.ts`, `printer.ts` (canonical round trip for the editor), `evaluate.ts` (total,
inert, reactive), `check.ts` (column-precise static checking), `functions.ts` (the library),
`convert.ts` (to and from the legacy operator tokens). `propResolvers/expression.ts` is the one
dispatcher branch it adds.

**Rules:**

- **No new value operators, and no new syntax.** The grammar in `ast.ts` is final. A need for
  computation is a function (below) or a host source.
- Handler and reference tokens use the `$` prefix followed by a **single lowercase word**, as before.
- Renderer-level operators appear as `node.type` values and are handled in `SchemaRenderer.tsx`.
- The legacy value tokens (`$eq`, `$and`, `$concat`, `$count`, `$filter`, `$find`, `$plural`,
  `$map`, `$pick`, `$not`, `$or`, `$in`, `$lt`, `$gt`, `$ne`, `$source`, prop-level `$if`) are the
  language's syntax tree as JSON. They keep resolving — `dispatcher.ts` still branches on them and
  `operatorParity.test.ts` still holds them to the zod union — but nothing is added to that set,
  and new schemas are written as expressions. `src/cli/we-expressions-codemod.ts` prints a file's
  operator trees into the new spelling.

## Adding a Library Function

A function is code, and gets the bar code gets: **three real uses**, or a divergence that is already
a bug. Then:

1. **Define it** in `shared/src/expressions/functions.ts` with `defineFunction({ name, category,
params, doc, example, impl })`. `params` in the library notation (`limit?`, `...values`); `doc`
   one sentence saying what it answers and what it does with bad input.
2. **Keep it pure and total.** No I/O, no throwing. Wrong-typed input answers with the empty value
   of its kind (`[]`, `''`, `0`, `false`, `undefined`) — a template that renders too little is
   recoverable, one that throws mid-paint takes the tree with it.
3. **Test it** in `shared/src/expressions/expressions.test.ts`.
4. **Regenerate the context** — `pnpm --filter @we/ai-context generate-context`. The reference
   lists the library from the registry; there is no doc to edit. `OPERATORS.md` and `README.md`
   describe the layers, not the functions.

Nothing else changes: not the parser, not the validator, not the renderer, not the zod union.

A function only one deployment needs is a **host source** — an entry in
`packages/app-shell/src/shared/sources/index.ts`, catalogued into the context and known to the
validator the same way.

## Adding a Handler Token

Rare, and deliberately so — the verbs are enumerable because grants attach to them. When one is
genuinely needed (a new _kind_ of side effect, not a new computation):

1. **Create the resolver** in `shared/src/propResolvers/<name>.ts`. Follow the existing signature —
   `stores`, `context`, `memo`, `resolvePropFn` for nested resolution — and take any computed
   argument as an expression rather than inventing a sub-grammar for it.
2. **Add the type** to `shared/src/types.ts` and the `OperatorToken` union; **export** it from
   `shared/src/index.ts`.
3. **Wire the dispatcher** (`dispatcher.ts`) and the **zod union** (`zodSchemas.ts`);
   `operatorParity.test.ts` fails until both agree.
4. **Teach the validator** (`semanticValidation.ts`) what the token may name.
5. **Tests** in `shared/tests/propResolvers.test.ts`; **docs** in the `schema-operators` fragment.

## Resolver Patterns

### Reactive vs. Plain Values

Resolvers that produce **derived values** (computed from stores or context) must wrap their return in `markReactive(memo(...))` so the renderer can track reactive dependencies:

```ts
return markReactive(
  memo(() => {
    // Compute derived value here
  }),
);
```

Resolvers that produce **static values** or **functions** (like `$action`) can return plain values.

**Rule:** If the resolved value could change when a store signal updates, it must be wrapped in `markReactive(memo(...))`.

### Nested Resolution

When an operator's payload may itself contain operators, delegate back to `resolvePropFn`:

```ts
const resolved = resolvePropFn(part, stores, context, memo);
```

The dispatcher handles recursion depth limits (max 10) automatically.

### The `REACTIVE_ACCESSOR` Symbol

`markReactive()` tags a function with the `REACTIVE_ACCESSOR` symbol. The renderer uses this to distinguish reactive accessors from event handlers — accessors get unwrapped, event handlers pass through to the DOM.

## Context Resolution (`$item.*` Strings)

Plain strings starting with `$` followed by a key present in the `context` object are resolved by the dispatcher:

```
"$item.name"       → context.item.name
"$space.uuid"      → context.space.uuid
"$team"            → context.team (whole object)
```

This is the mechanism `$each` children use to access the current iteration item, and `$map`'s `select` uses for `$item.*` references.

**Rules:**

- The context key (text between `$` and the first `.`) must exist in the context object — otherwise the string is returned as-is (no error).
- Dot-separated paths are walked recursively: `$item.profile.avatar` → `context.item.profile.avatar`.
- `$each` injects items into context using the `as` prop (default: `'item'`), so `$item.name` works by default.
- For nested `$each` loops, use distinct `as` values to avoid shadowing: `as: 'team'` → `$team.name`.

## Component Resolution

The renderer resolves `node.type` to a component using these rules (in order):

1. **Operator** — `$each`, `$if`, `$routes`, `$animate`, `$single` are handled as special cases.
2. **Registry lookup** — check the component registry by exact name.
3. **Native element** — lowercase single-word (`div`, `span`) → HTML element; hyphenated (`we-button`) → web component.
4. **Error** — unknown type throws.

**Naming convention:** PascalCase names (e.g. `AppShell`) are expected to be registered components. Lowercase/hyphenated names are native elements.

## Schema Structure

```ts
{
  type: 'we-box',           // Component to render
  props: { ... },           // Props resolved via the dispatcher
  children: [ ... ],        // Child nodes (SchemaNode[]) or text strings
  slots: { header: ... },   // Named slot content (SchemaNode per slot)
  slot: 'sidebar',          // Which parent slot this node fills
  theme: { primaryHue: 200 },  // Scoped parametric theme overrides
  routes: [ ... ],          // Route definitions (for $routes)
  $localState: { ... },     // Scoped mutable local state (signals, writable)
  $queries: { ... },        // Hoisted reactive query subscriptions (read-only, injected into $local)
}
```

- **Fragments**: Omit `type` to render children directly (no wrapper element). Useful with `theme` for scoped theming.
- **Text nodes**: Use plain strings in `children` arrays (e.g. for `<we-text>` content).
- **Slots**: Components declare slot support; schemas fill them via the `slots` map. The renderer passes slot elements as props.

## Type System

- `SchemaProp` — the recursive base type for all prop values. Kept as `string | number | boolean | Record<string, unknown> | SchemaProp[] | undefined` for Zod compatibility.
- `OperatorToken` — union of all typed operator tokens. Opt-in for schema authors who want autocomplete; not enforced at the `SchemaNode.props` level.
- Individual token types (`StoreToken`, `ConcatToken`, etc.) are exported for use in utility functions and type guards.

**Rule:** New operator types are added to the `OperatorToken` union but `SchemaProp` stays generic — the Zod validation layer handles structural validation separately.
