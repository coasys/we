# @we/primitives

A modern, framework-agnostic library of atomic web components for the WE design system.

## Overview

`@we/primitives` provides a set of reusable, accessible, and themeable UI primitives built as [Web Components](https://developer.mozilla.org/en-US/docs/Web/Web_Components) using [Lit](https://lit.dev/). These components are the foundation of the WE design system and are intended to be used directly or wrapped by higher-level framework packages (e.g., React, Solid, Svelte).

- **Framework-agnostic:** Works in any frontend framework or plain HTML.
- **Type-safe:** Ships with type definitions and framework-specific typings for best DX.
- **Customizable:** Style via CSS variables and override with your own themes.
- **Accessible:** Built with a11y best practices.

## Installation

```sh
pnpm add @we/primitives
# or
yarn add @we/primitives
# or
npm install @we/primitives
```

## Usage

### In HTML

```html
<we-button>Click me</we-button>

<we-icon name="star" />
```

### Per-component imports

Each primitive is also a subpath entry — `import '@we/primitives/button'`
registers just that element (typed per framework via
`@we/primitives/solid/*` etc.).

### In a Framework (e.g., Solid, React, Vue)

1. **Register the elements (once, at app startup):**
   ```ts
   import '@we/primitives';
   ```
2. **Import CSS variables and theme:**
   ```ts
   import '@we/tokens/css';
   import '@we/themes';
   ```
3. **Use components in your JSX/TSX:**
   ```tsx
   <we-button variant="primary">Save</we-button>
   <we-icon name="user" />
   ```

## Components

- `<we-button>` – Button with variants, sizes, and states
- `<we-icon>` – SVG icon
- `<we-input>` – Accessible input field
- `<we-modal>` – Modal dialog
- `<we-popover>` – Popover/tooltip
- `<we-spinner>` – Loading spinner
- `<we-text>` – Typography primitive
- `<we-badge>` – Badge/label
- `<we-avatar>` – Avatar image
- ...and more

See the [Storybook](./.storybook/) for live demos and documentation.

## Theming & Customization

- All components use CSS variables for styling.
- Import `@we/tokens/css` for design tokens and `@we/themes` for theme overrides.
- Override variables in your own CSS to customize appearance.

## TypeScript & Framework Typings

- Ships with type definitions for all custom elements.
- Framework-specific typings (e.g., `@we/primitives/solid`) provide JSX/TSX support for Solid, React, etc.
- Types are auto-generated from the [Custom Elements Manifest](./custom-elements.json).

## Contributing

- Primitives are implemented in [`src/primitives/`](./src/primitives/) — one file per element, registered via `src/index.ts`.
- Run `pnpm build` to build the package.
- Run `pnpm start` (in this package) to start the local Storybook.
- See [`scripts/generate-framework-declarations.ts`](./scripts/generate-framework-declarations.ts) for type generation.

## License

MIT
