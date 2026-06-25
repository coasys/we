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

## Extending Utility Components with Layout Props

Utility components that appear in schemas and need layout control (width, flex sizing, margins, etc.) should support the full Design System prop set via `LayoutProps`.

### When to apply

Add this pattern when a component is used inline in schemas and authors need to control its size or position — e.g. `SearchInput` inside a `Row`, where `flex: '1'` or `maxWidth` is needed.

### Two variants

#### Variant A — inner element is a Solid component (Column, Row, etc.)

The inner element handles its own DS props, so the wrapper takes all of `layoutProps`.

**`ComponentName.solid.tsx`**:

```tsx
import type { LayoutProps } from '@we/design-utils/solid';
import { buildLayoutStyles } from '@we/design-utils/solid';
import { createMemo, splitProps } from 'solid-js';
import type { ComponentNameProps as ComponentNameOwnProps } from './ComponentName.types';

export type ComponentNameProps = Omit<LayoutProps, 'children' | 'styles'> & ComponentNameOwnProps;

const ownKeys = ['propA', 'propB', 'class'] as const;

export function ComponentName(allProps: ComponentNameProps) {
  const [props, layoutProps] = splitProps(allProps, ownKeys);

  const wrapperStyle = createMemo(() =>
    buildLayoutStyles({ ...layoutProps, display: layoutProps.display ?? 'block' } as LayoutProps, 'column'),
  );

  return (
    <div style={wrapperStyle()}>
      <inner-solid-component style={{ width: '100%' }} ... />
    </div>
  );
}
```

#### Variant B — inner element is a web component (we-input, we-button, etc.)

Web components (Lit `DesignSystemElement`) have their own built-in DS defaults (e.g. `we-input` defaults to `bg: 'neutral-50'`). If the wrapper div receives `bg`, `r`, etc., the web component's shadow DOM overrides them. The fix: split DS props into two groups — container props on the wrapper div, visual/typography/state props forwarded to the web component via DOM property assignment.

**`ComponentName.solid.tsx`**:

```tsx
import type { LayoutProps } from '@we/design-utils/solid';
import { buildLayoutStyles } from '@we/design-utils/solid';
import { createEffect, createMemo, createSignal, splitProps } from 'solid-js';
import type { ComponentNameProps as ComponentNameOwnProps } from './ComponentName.types';

export type ComponentNameProps = Omit<LayoutProps, 'children'> & Omit<ComponentNameOwnProps, 'styles'>;

const ownKeys = ['propA', 'propB', 'class'] as const;

// Layout/positioning props that stay on the outer wrapper div.
// Everything else (bg, color, r, border, typography, state, padding, height) is forwarded to the WC.
const containerKeys = [
  'display', 'flex', 'alignSelf',
  'width', 'minWidth', 'maxWidth',
  'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml',
  'position', 'top', 'right', 'bottom', 'left', 'zIndex',
  'overflow', 'overflowX', 'overflowY', 'scrollbarWidth', 'scrollbarGutter',
] as const;

export function ComponentName(allProps: ComponentNameProps) {
  const [props, rest] = splitProps(allProps, ownKeys);
  const [containerProps, inputProps] = splitProps(rest, containerKeys);

  const wrapperStyle = createMemo(() =>
    buildLayoutStyles({ ...containerProps, display: containerProps.display ?? 'block' } as LayoutProps, 'column'),
  );

  let wcRef: (HTMLElement & Record<string, unknown>) | undefined;

  // Forward visual DS props to the web component as DOM properties.
  // DesignSystemElement registers all DS keys as reactive Lit properties, so property
  // assignment triggers its updated() cycle and applies the new CSS custom vars.
  createEffect(() => {
    if (!wcRef) return;
    for (const key of Object.keys(inputProps as object)) {
      const val = (inputProps as Record<string, unknown>)[key];
      if (val !== undefined) wcRef[key] = val;
    }
  });

  return (
    <div style={wrapperStyle()}>
      <we-web-component
        ref={wcRef}
        style={{ width: '100%' }}
        ...
      />
    </div>
  );
}
```

**Why property assignment, not JSX attributes?** DS state props (`hoverProps`, `activeProps`, `focusProps`) are registered as `@property({ type: Object, attribute: false })` in the Lit mixin — they must be set as JS properties, not HTML attributes. Using DOM property assignment via `ref` + `createEffect` handles both string and object props uniformly.

### Rules (both variants)

- **`ownKeys`** lists only the component's own props. All unrecognised props route to the wrapper (Variant A) or to the WC (Variant B).
- **`class`** goes in `ownKeys` so it forwards to the inner element, not the wrapper — unless you want it on the wrapper.
- **Default `display: 'block'`** on the wrapper. `buildLayoutStyles` defaults to `'flex'`, which is wrong for non-layout components. Users can still pass `display: 'flex'` explicitly to override.
- **Inner element gets `width: 100%`** so it fills whatever size the wrapper is given.
- **Don't add `LayoutProps` to `*.types.ts`** — it's Solid-specific. The extended type lives only in `*.solid.tsx`.
- **After any change**, rebuild the package (`pnpm --filter @we/components build`) and regenerate docs (`pnpm --filter @we/ai-context generate-context`) so CLAUDE.md reflects the new props.

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
