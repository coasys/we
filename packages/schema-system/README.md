# Schema System

The schema system provides a framework-agnostic, schema-driven UI renderer designed for modular web apps. It turns declarative JSON-like schemas into live, reactive UIs, supporting layouts, routing, slots, and dynamic data/actions.

## Packages

- **`@we/schema-shared`** (`shared/`) — Framework-agnostic types, validators, prop resolvers, and mutations
- **`@we/schema-solid`** (`solid/`) — SolidJS renderer implementation

## Features

### Prop-Level Operators

Operators that appear inside `props` and resolve to values:

| Operator | Purpose | Example |
|----------|---------|---------|
| `$store` | Reactive store access | `{ $store: 'userStore.name' }` |
| `$expr` | JavaScript expression eval | `{ $expr: '\`Hello ${user.name}\`' }` |
| `$action` | Store method call | `{ $action: 'store.method', args: ['$arg.id'] }` |
| `$map` | Array/object transformation | `{ $map: { items: ..., select: { ... } } }` |
| `$pick` | Property extraction | `{ $pick: { from: ..., props: ['a', 'b'] } }` |
| `$if` | Conditional value | `{ $if: { condition: ..., then: 'a', else: 'b' } }` |
| `$eq` / `$ne` | Equality / inequality | `{ $eq: [{ $store: 'x.role' }, 'admin'] }` |
| `$not` | Logical NOT | `{ $not: { $store: 'x.locked' } }` |
| `$and` / `$or` | Logical AND / OR | `{ $and: [cond1, cond2] }` |

### Renderer Operators

Operators that appear as the `type` field and control rendering structure:

| Operator | Purpose |
|----------|---------|
| `$if` (node) | Conditional rendering with optional transitions |
| `$forEach` | List rendering with context injection |
| `$routes` | Route outlet placeholder |
| Fragment | Renders children without wrapper (no `type`) |
| HTML passthrough | Lowercase types render as native elements |

### Other Features

- **Slots:** Named slots for layout composition
- **Component registry:** PascalCase → registered component, `we-*` → web component, lowercase → HTML element
- **REACTIVE_ACCESSOR:** Signal tagging for web component prop unwrapping
- **Schema validation:** Zod-based validation with `validateSchema()`
- **Schema mutations:** `findMutations()` for diff-based updates, `updateSchema()` for applying changes
- **Schema versioning:** `schemaVersion` field for future migrations
- **Transitions:** `TransitionConfig` for animated `$if` node show/hide (`fade`, `slide`, `scale`)
- **Operator token types:** `StoreToken`, `ActionToken`, `OperatorToken`, etc. for typed schema authoring

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
- **Operator token types:** `StoreToken`, `ExprToken`, `ActionToken`, `IfToken`, `MapToken`, `PickToken`, `EqToken`, `NeToken`, `NotToken`, `AndToken`, `OrToken`, `OperatorToken`
- **Functions:** `resolveProp()`, `resolveProps()`, `splitProps()`, `validateSchema()`, `findMutations()`, `hasToken()`
- **Constants:** `REACTIVE_ACCESSOR`

### `@we/schema-solid`

- **`RenderSchema`:** Main renderer component
- **`updateSchema()`:** Apply mutations to a reactive Solid store

## License

MIT
