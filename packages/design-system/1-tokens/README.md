# @we/tokens

A modern, JavaScript-first design token system that provides type-safe tokens and dynamic CSS variables for building consistent user interfaces across platforms.

## Features

- 🎯 **TypeScript-first**: Full type safety with IntelliSense support
- 🎨 **Dynamic theming**: CSS variables that respond to configuration changes
- 📦 **Modular imports**: Import only what you need
- 🔧 **Flexible consumption**: Use as JS objects or CSS variables
- ⚡ **Zero runtime**: Compile-time token generation
- 🎛️ **Theme flexibility**: Built-in support for theme switching

## Installation

```bash
npm install @we/tokens
# or
yarn add @we/tokens
# or
pnpm add @we/tokens
```

## Usage

### Option 1: CSS Variables (Recommended for styling)

Include all design tokens as CSS variables:

```css
/* Import everything */
@import '@we/tokens/css';

/* Or import specific categories */
@import '@we/tokens/css/color';
@import '@we/tokens/css/space';
@import '@we/tokens/css/font';
```

Use in your CSS:

```css
.button {
  background: var(--we-color-primary-500);
  color: var(--we-color-white);
  font-family: var(--we-font-family);
  font-size: var(--we-font-size-400);
  padding: var(--we-space-300) var(--we-space-500);
  border-radius: var(--we-border-radius);
  box-shadow: var(--we-depth-200);
}
```

### Option 2: JavaScript/TypeScript Tokens (Recommended for logic)

```typescript
// Import all tokens
import { tokens } from '@we/tokens';

// Import specific token categories with types
import { color, space, font, type ColorHueToken, type SpaceToken } from '@we/tokens';

// Type-safe usage
const primaryColor: ColorHueToken = 'primary';
const buttonPadding: SpaceToken = '400';

// Usage examples
element.style.backgroundColor = color.primary['500'];
element.style.fontSize = font.size['400'];
element.style.padding = `${space['300']} ${space['500']}`;
```

### Option 3: Individual Token Imports

```typescript
// Import only what you need
import { color, type ColorHueToken } from '@we/tokens/color';
import { space, type SpaceToken } from '@we/tokens/space';
import { animation } from '@we/tokens/animation';

// Smaller bundle size with tree-shaking
```

## Available Token Categories

### Core Tokens

- **🎬 animation** - Transition durations and timing functions
- **🔲 border** - Border widths, radius values, and colors
- **🎨 color** - Complete color system with semantic meanings
- **🧩 component** - Component-specific styling tokens
- **✨ effect** - Box shadows and visual effects
- **📝 font** - Typography families and size scales
- **📏 size** - Dimensional values for components
- **📐 space** - Spacing and layout measurements

### Dynamic Color System

The color system supports dynamic theming through CSS variable relationships:

```css
/* Change the base saturation - all colors update automatically */
:root {
  --we-color-saturation: 80%; /* More vibrant */
  --we-color-ui-saturation: 15%; /* Slightly more colorful UI */
}

/* Or adjust lightness calculations for dark mode */
:root {
  --we-color-multiplier: -1;
  --we-color-subtractor: 100%;
}
```

## Type Safety

Full TypeScript support with exported types:

```typescript
import {
  type ColorHueToken, // 'ui' | 'primary' | 'success' | 'warning' | 'danger'
  type ColorLightnessToken, // '0' | '25' | '50' | ... | '1000'
  type SpaceToken, // '0' | '100' | '200' | '300' | ... | '1000'
  type FontSizeToken, // 'base' | '100' | '200' | ... | '1000'
  type AnimationTransitionToken, // '0' | '100' | '200' | '300' | '400' | '500'
} from '@we/tokens';

// Type-checked function
function createButton(size: SpaceToken, color: ColorHueToken) {
  return {
    padding: space[size],
    backgroundColor: color.primary['500'],
  };
}
```

## CSS Custom Properties

All tokens are available as CSS custom properties with the `--we-` prefix:

```css
.card {
  background: var(--we-color-white);
  border: var(--we-border-width) solid var(--we-border-color);
  border-radius: var(--we-border-radius-lg);
  box-shadow: var(--we-depth-200);
  font-family: var(--we-font-family);
  padding: var(--we-space-500);
}

.button--primary {
  background: var(--we-color-primary-500);
  color: var(--we-color-white);
  transition: all var(--we-transition-200);
}

.button--primary:hover {
  background: var(--we-color-primary-600);
}
```

## Theme Customization

### Method 1: CSS Variable Override

```css
:root {
  /* Change brand colors */
  --we-color-primary-hue: 210; /* Blue instead of default */

  /* Adjust overall saturation */
  --we-color-saturation: 70%;

  /* Custom font */
  --we-font-family: 'Inter', sans-serif;
}
```

### Method 2: JavaScript Theme Switching

```javascript
// Dynamic theme switching
function applyTheme(theme) {
  const root = document.documentElement;

  if (theme === 'vibrant') {
    root.style.setProperty('--we-color-saturation', '80%');
    root.style.setProperty('--we-color-ui-saturation', '20%');
  } else if (theme === 'muted') {
    root.style.setProperty('--we-color-saturation', '40%');
    root.style.setProperty('--we-color-ui-saturation', '5%');
  }
}
```

## Token Structure

```typescript
// Example token structure
const tokens = {
  color: {
    primary: {
      '0': 'hsl(610, 60%, 100%)', // Lightest
      '500': 'hsl(610, 60%, 50%)', // Base
      '1000': 'hsl(610, 60%, 0%)', // Darkest
    },
    ui: {
      /* UI colors with lower saturation */
    },
    base: { white: '#ffffff', black: '#000000' },
  },
  space: {
    '100': '0.25rem', // 4px
    '400': '1rem', // 16px
    '1000': '4rem', // 64px
  },
  font: {
    family: { base: "'DM Sans', sans-serif" },
    size: {
      base: '16px',
      '400': '0.88rem', // 14px
      '500': '1rem', // 16px
    },
  },
};
```

## Development

This package uses a modern build system that generates CSS variables from TypeScript token definitions:

- **Source of truth**: TypeScript token files
- **Generated output**: CSS variables with dynamic relationships
- **Type definitions**: Full TypeScript support for consumers

## License

MIT
