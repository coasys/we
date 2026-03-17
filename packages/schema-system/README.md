# @we/schema-renderer

`@we/schema-renderer` is a framework-agnostic, schema-driven UI renderer designed for modular web apps. It turns declarative JSON-like schemas into live, reactive UIs, supporting layouts, routing, slots, and dynamic data/actions. The package is structured for easy extension to multiple frameworks (SolidJS, React, etc.) and is ideal for both human and AI-generated interfaces.

## Features

- **Schema-based UI:** Describe layouts, components, and routing using a flexible schema format.
- **Dynamic props:** Supports `$store`, `$expr`, `$action`, `$map`, and `$pick` tokens for state, expressions, actions, array mapping, and object property selection.
- **Routing:** Handles nested route trees and `$routes` outlets for dynamic page content.
- **Slots:** Named slots for layout composition; renders slot content using a registry or as fragments.
- **Component registry:** Looks up components by type from a registry, allowing apps to provide their own mapping.
- **Extensible:** Shared logic and types for multi-framework support; only the rendering layer is framework-specific.
- **AI-friendly:** Designed for automated UI generation and mutation, with conventions for slotting, routing, and layout.

## Usage

1. **Install:**

   ```sh
   pnpm add @we/schema-renderer solid-js
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
   import { RenderSchema } from '@we/schema-renderer/solid';
   import { registry } from './registry';

   <RenderSchema node={mySchema} stores={myStores} registry={registry} />;
   ```

## Extending to Other Frameworks

- Shared types and prop resolvers are in `src/shared`.
- Framework-specific renderers are in `src/frameworks/{framework}`.
- To add support for another framework, implement a renderer that uses the shared logic and passes the correct JSX type.

## API

- `RenderSchema`: Main renderer function/component for SolidJS (other frameworks can implement their own).
- `ComponentRegistry`: Mapping of type strings to actual components.
- `SchemaNode`, `RouteSchema`, `TemplateSchema`: Generic types for describing UI structure.

## License

MIT
