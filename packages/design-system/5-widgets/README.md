# @we/widgets

Generic composite widgets — the design system's highest layer. Composition
above widgets is the schema system's job, and *feature* widgets live with
their module family (the globe widget in `module-system/globe/widget`, the
graph view in `graph-system/`), so this package stays small on purpose.

## Contents

- **`CollapsibleSidebar`** (`src/widgets/sidebars/CollapsibleSidebar/`) — the
  collapsible, hover-expandable sidebar the shell's rails are built from.
  Props are documented in the generated registry (`CLAUDE.md`, `@we/widgets`
  section) and in `CollapsibleSidebar.types.ts`.

## Usage

```tsx
import { CollapsibleSidebar } from '@we/widgets/solid';
import '@we/widgets/styles';
```

Peer: `@we/primitives` (types), `solid-js`. Runtime dep: `@we/design-utils`
(externalized — the live package resolves at runtime).

## Adding a widget

A widget belongs here only when it is generic — usable by any template with
no feature-module knowledge. Follow the design-system
[`CONVENTIONS.md`](../CONVENTIONS.md) (directory layout, `.types.ts`,
`@ai` tags for non-obvious prop shapes).

## License

MIT
