# Components & Widgets — Design Conventions

Rules and patterns for building UI components (`4-components/`) and widgets (`5-widgets/`).

## Package Roles

| Package                           | Scope                                                    | Examples                               |
| --------------------------------- | -------------------------------------------------------- | -------------------------------------- |
| `4-components` (`@we/components`) | Single-purpose Solid components composed from primitives | AvatarStack, Column, Row, DropdownMenu |
| `5-widgets` (`@we/widgets`)       | Composite blocks combining multiple components           | currently empty — see its README      |

Components are leaf-level building blocks. Widgets encapsulate higher-level features. Composition above widgets is handled by the schema system.

## Does this deserve to be code at all?

> **Code owns only what data cannot express**: behaviour and focus management, accessibility
> semantics, browser APIs, measurement, performance-critical rendering. That is the whole list.
> Everything above it is arrangement, and arrangement belongs in the schema layer — a template
> fragment (`@we/template-kit`) or plain nodes — where an author can edit it.

A component that is only a fixed arrangement of primitives is the anti-pattern this rule exists
for: it freezes layout decisions behind props nobody can extend from a template, and because
templates cannot use it and code does not need it, it dies unused. Nine of them were deleted in
one sweep (`PostCard`, `CircleButton`, `IconLabelButton`, `List`, `Table`, `Timeline`, `Accordion`,
`Breadcrumbs`, `Stepper`) — every one pure arrangement, every one with zero consumers, one
carrying an invalid design token nobody had noticed because nothing rendered it. Function-valued
props (`renderItem`, `renderCell`) are the tell: a schema cannot express a render function, so a
component built around one is unreachable from the layer composition is supposed to happen in.

The test before adding a component: **name the thing it does that a `Column` full of primitives
cannot.** `AvatarStack` has overlap maths; `CollapsedContent` measures; `DropdownMenu` owns focus.
If the answer is "it groups things nicely", it is a fragment.

## One vocabulary, two grammars

Components serve two consumers, and the same rules keep them from diverging:

- **Schemas** reach components through the registry (`componentRegistry.tsx`). A registry entry is
  vocabulary the validator accepts and the AI is taught — never register a component templates
  cannot meaningfully drive.
- **TSX code** (the editor, app-shell chrome) imports components directly, and composes them with
  JSX the way schemas compose them with fragments.

Neither side may re-implement what the other layer owns: fragments arrange components, never
rebuild them; TSX composes primitives and components, never raw HTML with inline styles. That is
what keeps visual identity single-sourced while the two arrangement grammars stay independent.

When one _pattern_ is genuinely needed identically on both sides, there are exactly two moves —
never a second copy:

1. **Demote it to a component** — when it carries behaviour anyway, or pixel-identity matters more
   than template editability (`SignalControl`).
2. **Mount a schema island in TSX** via `RenderSchema` — when the shared thing is data-driven and
   themeable. The shell does this wholesale: Settings, BootScreen and the sidebar are schemas
   rendered inside the Solid app.

Which app surfaces get built as schemas at all follows one rule: **surfaces a deployment should be
able to white-label or replace are schemas; tools are code.** The settings pages are schemas; the
editor's inspector is not, and should not be — the tool must keep working while the schema it is
editing is broken, and rebuilding tool UI as schemas would pressure the operator language toward
general-purpose growth the schema system deliberately refuses.

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
export interface FlipCardProps {
  width?: string;
  flipOnHover?: boolean;
  styles?: Record<string, string | number>;
}

// ❌ Bad — Solid-specific
import { JSX } from 'solid-js';
export interface FlipCardProps {
  width?: string;
  styles?: JSX.CSSProperties;
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
