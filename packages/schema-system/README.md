# Schema System

The schema system provides a framework-agnostic, schema-driven UI renderer designed for modular web apps. It turns declarative JSON-like schemas into live, reactive UIs, supporting layouts, routing, slots, and dynamic data/actions.

## Packages

- **`@we/schema-shared`** (`shared/`) — Framework-agnostic types, validators, prop resolvers, and mutations
- **`@we/schema-solid`** (`solid/`) — SolidJS renderer implementation

## Features

### Values: one expression language

Anything computed — a condition, a label, a count, a filtered list — is one expression in a
`{ $: '…' }` token, with a closed grammar and an open function library
(`shared/src/expressions/`):

| Written as                                           | Answers                                  |
| ---------------------------------------------------- | ---------------------------------------- |
| `{ $: "spaceStore.members.count() > 0" }`            | a boolean                                |
| `{ $: "` `` `/space/${item.uuid}` `` `" }`           | a string                                 |
| `{ $: "item.author == me.did ? 'mine' : 'theirs'" }` | a value                                  |
| `{ $: "filter(local.rows, { role: 'admin' }, 5)" }`  | a list — the where-object `$query` takes |
| `{ $: "items.filter(x, x.done).map(x, x.title)" }`   | a list, by comprehension                 |
| `{ $: "plural(count(local.rows), 'row', 'rows')" }`  | a library call                           |

References start from a store, `local`, a name `$each` bound, `me`, `surface`, or `event` inside a
handler. Checked statically with a column; total and inert at paint. The legacy value tokens
(`$eq`, `$and`, `$concat`, `$count`, `$filter`, `$find`, `$plural`, `$map`, `$pick`, prop-level
`$if` …) are this language written as JSON and still render.

### Reference and handler tokens

| Token         | Purpose                             | Example                                                            |
| ------------- | ----------------------------------- | ------------------------------------------------------------------ |
| `$store`      | Reactive store access               | `{ $store: 'userStore.name' }`                                     |
| `$local`      | A `$localState` / `$queries` field  | `{ $local: 'searchText' }`                                         |
| `$action`     | Store method call + async lifecycle | `{ $action: 'store.method', args: ['$arg.id'], onSuccess: [...] }` |
| `$setLocal` … | Write local state                   | `{ $setLocal: 'page', value: { $: 'local.page + 20' } }`           |
| `$query`      | Data retrieval                      | `{ $query: { entity: 'Post', where: { … } } }`                     |
| `$item.*`     | Context reference (legacy string)   | `'$space.name'` (inside `$each` children)                          |

### Renderer Operators

Operators that appear as the `type` field and control rendering structure:

| Operator         | Purpose                                         |
| ---------------- | ----------------------------------------------- |
| `$if` (node)     | Conditional rendering with optional transitions |
| `$each`          | List rendering with context injection           |
| `$routes`        | Route outlet placeholder                        |
| Fragment         | Renders children without wrapper (no `type`)    |
| HTML passthrough | Lowercase types render as native elements       |

### Other Features

- **Slots:** Named slots for layout composition
- **Component registry:** PascalCase → registered component, `we-*` → web component, lowercase → HTML element
- **REACTIVE_ACCESSOR:** Signal tagging for web component prop unwrapping
- **Schema validation:** Zod-based validation with `validateSchema()`
- **Schema mutations:** `findMutations()` for diff-based updates, `updateSchema()` for applying changes
- **Schema versioning:** `schemaVersion` field for future migrations
- **Transitions:** `TransitionConfig` for animated `$if` node show/hide (`fade`, `slide`, `scale`)
- **Operator token types:** `StoreToken`, `ConcatToken`, `ActionToken`, `OperatorToken`, etc. for typed schema authoring

See [OPERATORS.md](./OPERATORS.md) for the full operator reference.

## Usage

1. **Install:**

   ```sh
   pnpm add @we/schema-shared @we/schema-solid solid-js
   ```

2. **Create a component registry in your app:**

   ```ts
   import { MyComponent, AnotherComponent } from './components';
   export const registry = {
     MyComponent,
     AnotherComponent,
     // ...other components
   };
   ```

3. **Render a schema:**

   ```tsx
   import { RenderSchema } from '@we/schema-solid';
   import { registry } from './registry';

   <RenderSchema node={mySchema} stores={myStores} registry={registry} />;
   ```

## Extending to Other Frameworks

- Shared types and prop resolvers are in `shared/`.
- Framework-specific renderers are in `solid/` (add `react/`, etc. for other frameworks).
- To add support for another framework, implement a renderer that uses the shared logic and passes the correct JSX type.

## API

### `@we/schema-shared`

- **Types:** `SchemaNode`, `TemplateSchema`, `RouteSchema`, `SchemaProp`, `ComponentRegistry`, `RenderProps`, `RendererOutput`, `TransitionConfig`
- **Operator token types:** `ExpressionToken`, `StoreToken`, `ActionToken`, `IfToken`, `MapToken`, `PickToken`, `EqToken`, `NeToken`, `NotToken`, `AndToken`, `OrToken`, `OperatorToken`
- **Expressions:** `parseExpression()`, `printExpression()`, `evaluateExpression()`, `checkExpression()`, `defineFunction()`, `listFunctions()`, `operatorToExpr()`, `exprToOperator()`
- **Functions:** `resolveProp()`, `resolveProps()`, `splitProps()`, `validateSchema()`, `findMutations()`, `hasToken()`
- **Constants:** `REACTIVE_ACCESSOR`

### `@we/schema-solid`

- **`RenderSchema`:** Main renderer component
- **`updateSchema()`:** Apply mutations to a reactive Solid store

## License

MIT
