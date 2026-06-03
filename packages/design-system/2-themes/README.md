# @we/themes

Official CSS themes for the WE design system.

## Overview

`@we/themes` provides a set of ready-to-use, customizable CSS themes for the WE design system. Each theme is built on top of the design tokens from `@we/tokens` and is designed to be consumed by any frontend framework or plain HTML.

- **Multiple themes:** Includes `dark`, `black`, `retro`, `cyberpunk`, and more.
- **Composable:** Import only the themes you need.
- **Framework-agnostic:** Works with any frontend stack.
- **Easy to extend:** Create your own themes by copying and modifying the provided CSS.

## Installation

```sh
pnpm add @we/themes
# or
yarn add @we/themes
# or
npm install @we/themes
```

## Usage

### In CSS

```css
/* Import base tokens first */
@import '@we/tokens/css';

/* Then import a theme */
@import '@we/themes/dark';
```

### In HTML

```html
<link rel="stylesheet" href="node_modules/@we/tokens/dist/css/index.css" />
<link rel="stylesheet" href="node_modules/@we/themes/dist/dark/index.css" />
```

### In JavaScript/TypeScript (Vite, Webpack, etc.)

```js
import '@we/tokens/css';
import '@we/themes/dark';
```

## Available Themes

- `@we/themes/dark` – Dark theme
- `@we/themes/black` – High-contrast black theme
- `@we/themes/retro` – Retro/vintage theme
- `@we/themes/cyberpunk` – Cyberpunk neon theme
- `@we/themes` – Base theme (default)

## How It Works

- Each theme overrides the CSS variables defined in `@we/tokens/css`.
- You can switch themes at runtime by swapping the imported CSS or toggling `<link>` tags.
- Themes are pure CSS—no JavaScript required.

## Customization

- To create your own theme, copy one of the theme folders in `src/`, modify the variables, and build.
- You can also override variables in your app’s CSS after importing a theme.

## Contributing

- Themes are located in `src/` (one folder per theme).
- Run `pnpm build` to generate the distributable CSS in `dist/`.
- Add new themes by creating a new folder and `index.css`.

## License

MIT
