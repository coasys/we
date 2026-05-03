# Schema System — Design Conventions

Rules and patterns for building and maintaining the schema-driven rendering system (`@we/schema-shared` + `@we/schema-solid`).

## Package Structure

| Directory | Package             | Purpose                                                         |
| --------- | ------------------- | --------------------------------------------------------------- |
| `shared/` | `@we/schema-shared` | Framework-agnostic types, prop resolvers, validators, mutations |
| `solid/`  | `@we/schema-solid`  | SolidJS renderer implementation                                 |

All operator resolution logic lives in `shared/` — the renderer layer (`solid/`) only handles DOM construction and framework-specific reactivity.

## Operator Naming

All operators use the `$` prefix followed by a **single lowercase word**:

```
$store  $action  $concat  $map  $pick  $if  $not  $eq  $ne  $in  $and  $or  $each  $routes
```

**Rules:**

- Always a single word — no camelCase, no hyphens, no multi-word names.
- Prop-level operators (resolved by `dispatcher.ts`) use object syntax: `{ $store: '...' }`.
- Renderer-level operators (`$each`, `$if`, `$routes`) appear as `node.type` values and are handled in `SchemaRenderer.tsx`.
- Context reference strings (`$item.name`, `$space.uuid`) are **not** operators — they're resolved inline by the dispatcher as plain strings.

## Two Operator Categories

### Prop-Level Operators

Resolved by the dispatcher during prop resolution. Each has a dedicated resolver file in `shared/src/propResolvers/`.

| Operator  | File             | Purpose                               |
| --------- | ---------------- | ------------------------------------- |
| `$store`  | `store.ts`       | Read from reactive stores             |
| `$action` | `action.ts`      | Create event handler functions        |
| `$concat` | `concat.ts`      | Join parts into a string              |
| `$map`    | `map.ts`         | Transform array data into prop values |
| `$pick`   | `pick.ts`        | Select subset of props from a source  |
| `$if`     | `conditional.ts` | Conditional value (ternary)           |
| `$eq`     | `comparisons.ts` | Equality check                        |
| `$ne`     | `comparisons.ts` | Inequality check                      |
| `$in`     | `comparisons.ts` | Set membership check                  |
| `$not`    | `comparisons.ts` | Boolean negation                      |
| `$and`    | `comparisons.ts` | Short-circuit AND                     |
| `$or`     | `comparisons.ts` | Short-circuit OR                      |

### Renderer-Level Operators

Handled directly in `SchemaRenderer.tsx` as special `node.type` values. These control DOM structure, not prop values.

| Operator  | Purpose                                      |
| --------- | -------------------------------------------- |
| `$each`   | Iterate over items, render children per item |
| `$if`     | Conditionally render a node subtree          |
| `$routes` | Render routed children                       |

## Adding a New Prop-Level Operator

1. **Create the resolver** in `shared/src/propResolvers/<name>.ts`. Follow the existing function signature pattern — accept `stores`, `context`, `memo`, and `resolvePropFn` for nested resolution.
2. **Add the type** to `shared/src/types.ts` as a named token type (e.g. `FooToken = { $foo: ... }`), and add it to the `OperatorToken` union.
3. **Wire into the dispatcher** in `dispatcher.ts` — add a `hasToken(value, '$foo', ...)` branch in the token resolution block. Order matters: more specific/common operators first.
4. **Export** the token type from `shared/src/index.ts`.
5. **Add tests** in `shared/tests/propResolvers.test.ts`.
6. **Update docs** — add an entry in `OPERATORS.md` and update the table in `README.md`.

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

1. **Operator** — `$each`, `$if`, `$routes` are handled as special cases.
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
