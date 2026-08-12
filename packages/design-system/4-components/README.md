# @we/components

Framework-level components and layout primitives for the WE design system.

## Overview

`@we/components` provides framework-specific components (currently for
SolidJS) one level above the atomic web components in
[`@we/primitives`](../3-primitives): layout primitives, composite inputs, and
the block display/input pairs the block system registers.

- **Framework-first:** written for Solid, not wrappers around web components.
- **Type-safe:** every component has a `.types.ts` beside its `.solid.tsx`.
- **One layout scaffold:** `Column`, `Row`, `Grid` and `Card` are all
  `createLayoutComponent(...)` (see
  `src/components/layout/createLayoutComponent.tsx`) — the shared
  splitProps → DS-props → style pipeline, including
  hover/active/focus/disabled state props.

## Layering

- **@we/primitives** — framework-agnostic web components (atoms)
- **@we/components** — Solid layout + composites (this package)
- **@we/widgets** — larger generic widgets; feature widgets live with their
  module family

## Usage (SolidJS)

```ts
// app entry — you control global side effects:
import '@we/tokens/css';
import '@we/themes';
import '@we/primitives';
```

```tsx
import { Card, Column, Row } from '@we/components/solid';

<Column gap="400" px="400">
  <Row gap="200" ay="center">
    <we-icon name="star" />
    <we-text>Starred</we-text>
  </Row>
  <Card bg="neutral-0">…</Card>
</Column>;
```

The full component list and per-component props are documented in the
generated registry (`CLAUDE.md`, "Component Registry" — `@we/components`
section); the DS props (`gap`, `p`, `bg`, `r`, `hoverProps`, …) are the
"Design System Props" section of the same reference.

## Styling

Component styles are authored as `.scss` next to each component and
aggregated by `src/styles/index.scss` into one compiled stylesheet
(`dist/styles/index.css`); DS props compute inline styles through
`@we/design-utils`. There are no per-component CSS modules.

## Layout

- Solid components: [`src/components/`](./src/components/) (grouped by kind:
  `layout/`, `inputs/`, `blocks/`, `media/`, …), exported through
  [`src/frameworks/solid/`](./src/frameworks/solid/).
- Conventions (directory structure, `.types.ts` rule, `@ai` tags):
  [`../CONVENTIONS.md`](../CONVENTIONS.md).

## License

MIT
