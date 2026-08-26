# WE Design System

The foundational packages powering UI, theming, and the component experience
across all WE applications and modules — a set of composable packages, each
with one responsibility, layered bottom-up.

## Packages

- **1-tokens/** (`@we/tokens`): Design tokens — spacing, color, typography,
  radius, z-index, and the semantic role variables — as CSS variables and a
  JS object. The generated CSS is snapshot-tested.
- **2-themes/** (`@we/themes`): What a theme _is_: the parametric vocabulary
  (`ThemeOverrides`), the built-in presets, the parameters→CSS mapping
  (`themeToStyle`/`applyThemeVars`), and the per-theme CSS files.
- **3-primitives/** (`@we/primitives`): Atomic Lit web components
  (`we-button`, `we-input`, …). Framework-agnostic; usable in any JS app,
  per-component importable (`@we/primitives/button`).
- **4-components/** (`@we/components`): Solid layout and composite components
  (Column, Row, Grid, Card, block displays/inputs), built on the shared
  DS-props machinery.
- **5-widgets/** (`@we/widgets`): Generic composite widgets — the highest
  design-system layer; composition above widgets is the schema system's job.
  Currently empty (its one widget, `CollapsibleSidebar`, was retired once
  `@we/template-kit`'s rail fragments replaced it). Feature widgets live with
  their module family (the globe widget, the graph view).
- **types/** (`@we/design-types`): The `DesignSystemProps` surface and shared
  type vocabulary.
- **utils/** (`@we/design-utils`): The DS-props → CSS computation shared by
  Lit primitives and Solid components, token resolvers, and the
  `DesignSystemProps` ↔ `designSystemKeys` invariant test.

All packages are consumed in-workspace (`workspace:*`); `publishConfig` is set
for eventual publishing. See each subpackage's README and `CONVENTIONS.md` for
authoring rules — the root [`CONVENTIONS.md`](./CONVENTIONS.md) holds the
directory structure and prop patterns every component follows.

## Contributing

Which of these packages your change belongs in — and whether it belongs here at
all rather than being a template fragment — is answered by
[`docs/contributing/surfaces.md`](../../docs/contributing/surfaces.md). The
workflow is in [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

Then follow the `CONVENTIONS.md` of the package you land in; the root
[`CONVENTIONS.md`](./CONVENTIONS.md) covers what every layer shares. Tests are
`pnpm --filter <pkg> test`. (There are no stories — Storybook was removed, and
the primitives' behaviour is asserted in their vitest suites instead.)

## License

MIT (per-package `license` fields).
