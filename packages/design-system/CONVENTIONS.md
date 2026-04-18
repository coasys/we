# Components & Widgets — Design Conventions

Rules and patterns for building UI components (`4-components/`) and widgets (`5-widgets/`).

## Package Roles

| Package                           | Scope                                                    | Examples                                     |
| --------------------------------- | -------------------------------------------------------- | -------------------------------------------- |
| `4-components` (`@we/components`) | Single-purpose Solid components composed from primitives | CircleButton, Column, Row, DropdownMenu      |
| `5-widgets` (`@we/widgets`)       | Composite blocks combining multiple components           | CollapsibleSidebar, CesiumGlobe, GraphWidget |

Components are leaf-level building blocks. Widgets encapsulate higher-level features. Composition above widgets is handled by the schema system.

## Directory Structure

Every component/widget follows the same layout:

```
ComponentName/
├── ComponentName.types.ts      ← shared prop interface (framework-agnostic)
├── ComponentName.solid.tsx     ← SolidJS implementation
├── ComponentName.scss          ← optional scoped styles (widgets only)
└── index.ts                    ← optional barrel (widgets only, when needed)
```

The barrel export at `src/frameworks/solid/index.ts` re-exports all components/widgets with framework-specific type declarations (e.g., `solid-elements.d.ts` for web component JSX types).

## Shared Types (`*.types.ts`)

Each component has a `*.types.ts` file defining its prop interface. These are **framework-agnostic** — importable by any framework implementation.

**Rules:**

- No framework imports (`solid-js`, `react`, `vue`, `svelte`)
- No `JSX.Element`, `ReactNode`, `Snippet`, or `Accessor<T>`
- Use `Record<string, string | number>` instead of `JSX.CSSProperties` for inline styles
- Use plain `boolean` instead of `Accessor<boolean>` for reactive state
- Use `string`, `number`, basic objects, arrays, and callbacks only

```ts
// ✅ Good — framework-agnostic
export interface PostCardProps {
  title: string;
  creator?: { name: string; avatar: string };
  style?: Record<string, string | number>;
}

// ❌ Bad — Solid-specific
import { JSX } from 'solid-js';
export interface PostCardProps {
  title: string;
  style?: JSX.CSSProperties;
}
```

### Slot Props

Slots (children, header, footer) are a **rendering concern** — they work differently across frameworks (JSX.Element in Solid, ReactNode in React, `v-slot` in Vue). Don't put them in shared types.

Instead, each framework impl extends the shared type:

```ts
// ComponentName.types.ts — pure data contract
export interface CollapsibleSidebarProps {
  items: CollapsibleSidebarItem[];
  // slots defined in each framework impl via extends
}

// ComponentName.solid.tsx — Solid adds slots
interface SolidCollapsibleSidebarProps extends CollapsibleSidebarProps {
  header?: JSX.Element;
  footer?: JSX.Element;
}
```

### Reactive Values in Arrays

When a shared type has a field like `checked: boolean` but the Solid impl needs to accept `Accessor<boolean> | boolean` (for signal passthrough in array items), define a Solid-specific override:

```ts
// Solid-specific: items within arrays can pass reactive accessors
type SolidDropdownMenuToggle = Omit<DropdownMenuToggle, 'checked'> & {
  checked: Accessor<boolean> | boolean;
};
```

This pattern is only needed for **values inside arrays** where Solid's compiler can't automatically wrap in getters (direct props are wrapped by the compiler).

## Framework Implementation (`*.solid.tsx`)

**Required pattern:**

```ts
// 1. Wildcard re-export all shared types for downstream consumers
export type * from './Component.types';
// 2. Import only the types used locally
import type { ComponentProps } from './Component.types';

// 3. Component function uses shared type (or Solid-specific extension)
export function Component(props: ComponentProps) { ... }
```

The `export type *` on line 1 ensures barrel exports chain correctly — the barrel imports from `.solid.tsx` and gets both the component and its types. Using `export type *` (TS 5.0+) avoids duplicating the named list between import and export.

## `@ai` JSDoc

Add `@ai` tags to types with non-obvious contracts:

```ts
/**
 * @ai Flexible dropdown menu for actions, toggles, and grouped items.
 * Use for context menus, settings panels, layer controls, and command palettes.
 */
export interface DropdownMenuProps { ... }
```

**Add `@ai` when:** Complex option shapes, multiple related types, nested structures, or non-schema-renderable components.

**Skip `@ai` when:** Name + props are self-describing (CircleButton, Row, PostCard).

## Widget-Specific Patterns

Widgets have additional affordances that components don't:

| Feature           | Components               | Widgets                                                            |
| ----------------- | ------------------------ | ------------------------------------------------------------------ |
| Barrel `index.ts` | No — direct imports only | Optional, when needed                                              |
| Scoped SCSS       | No — global styles only  | Yes (`Widget.scss`)                                                |
| Domain `types.ts` | No                       | Yes (e.g., CesiumGlobe's `LayerConfig`, GraphWidget's `GraphData`) |
| Mock data files   | No                       | Optional (`mockData.ts`)                                           |
| Context providers | No                       | Yes (e.g., `CollapsibleSidebarContext`)                            |

## Build

Both packages use tsup with `esbuild-plugin-solid`:

```
entry: { 'solid/index': 'src/frameworks/solid/index.ts' }
→ dist/solid/index.js + dist/solid/index.d.ts
```

The `frameworks/` directory exists to support future framework implementations (`frameworks/react/`, `frameworks/vue/`, etc.) without cluttering the source root.
