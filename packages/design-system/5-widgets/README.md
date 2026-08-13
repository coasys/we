# @we/widgets

Generic composite widgets — the design system's highest layer. Composition
above widgets is the schema system's job, and *feature* widgets live with
their module family (the globe widget in `module-system/globe/widget`, the
graph view in `graph-system/`), so this package stays small on purpose.

## Contents

Currently empty. Its one widget, `CollapsibleSidebar`, was retired once
`@we/template-kit`'s `railShell`/`railGroup`/`railItem` fragments (see
`packages/templates/kit/src/layout/rail.ts`) fully replaced what it did — a
node tree can express every customisation a props-in, arrangement-out widget
cannot. The package stays, ready for the next widget that genuinely needs to
be generic.

## Usage

```tsx
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
