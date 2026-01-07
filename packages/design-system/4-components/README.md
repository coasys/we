# @we/components

Framework-level components and layout primitives for the WE design system.

## Overview

`@we/components` provides framework-specific components (currently for SolidJS) that sit one level above the atomic web components in [`@we/primitives`](../3-primitives). These components are designed to be more ergonomic, composable, and idiomatic for your framework, while still being low-level enough to serve as building blocks for more complex UI (such as widgets or templates).

- **Framework-first:** Components are written for your framework (e.g., SolidJS), not just wrappers for web components.
- **Composable:** Use as layout primitives, containers, and simple UI elements in your app or in higher-level widgets.
- **Type-safe:** All props and tokens are fully typed for best DX.
- **No side effects:** No CSS or element registration is imported automatically—your app controls global side effects.

## Atomic Design Layer

- **@we/primitives:** Primitive, framework-agnostic web components (atoms)
- **@we/components:** Framework-level primitives and layout (molecules/organisms)
- **@we/widgets:** Complex, feature-rich components (templates/widgets)

## Installation

```sh
pnpm add @we/components
# or
yarn add @we/components
# or
npm install @we/components
```

## Usage (SolidJS)

1. **Register the web components and import CSS in your app entry:**
   ```ts
   import '@we/tokens/css';
   import '@we/themes/dark'; // or your chosen theme
   import '@we/primitives/solid';
   ```
2. **Use the Solid components in your app:**

   ```tsx
   import { Column, Row } from '@we/components/solid';

   <Column gap="400" px="400">
     <Row gap="200">
       <we-icon name="star" />
       <span>Starred</span>
     </Row>
   </Column>;
   ```

## API

### SolidJS

- `Column`, `Row`: Layout primitives with spacing, alignment, and token-based props.
- All props are typed and map to CSS variables or web component attributes.

### Shared

- `shared/types.ts`: Re-exports design token types from `@we/tokens` for use in your app or wrappers.

## Best Practices

- **Import CSS and register elements at the app root** for full control over global side effects.
- **Use these components as the next layer above web components,** and compose them into widgets or templates as needed.
- **No CSS is imported automatically**—you decide the order and inclusion.

## CSS Modules: Modularity & Usage

- **Per-component CSS:** Each component ships with its own `.module.css` file (compiled from `.module.scss`).
- **No global CSS bundle:** We do NOT merge component CSS modules into a single file. This preserves class name scoping and avoids collisions.
- **How to use:**
  - Import only the styles for the components you use:
    ```ts
    import '@we/components/solid/components/cards/PostCard/PostCard.module.css';
    ```
- **Global styles:** The global styles entry (`solid/styles/index.scss`) is for global/utility styles only (tokens, resets, etc.), NOT for component modules.
- **Why:** This ensures true modularity and prevents style conflicts between components.

> **Note:** You must configure your app's build tool (Vite, Webpack, etc.) to handle CSS imports from node_modules.

## Contributing

- Solid components are in [`src/solid/components/`](./src/solid/components/).
- Shared types and helpers are in [`src/shared/`](./src/shared/).
- Build with `pnpm build` (uses tsup and esbuild-plugin-solid).

## License

MIT
