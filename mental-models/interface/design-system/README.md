# Design system

The **design system** is the set of packages that a template draws with. They are design tokens, themes, primitives (Lit custom elements), components (Solid), the shared prop logic, and the drag session.

**Why:** Each layer depends only on the layers below it, so a primitive works in any framework and a theme reaches every template through the same variables. The rule for each piece is "code owns only what data cannot express": arrangement is a fragment, and only behaviour, focus, browser APIs and measurement are code (`design-system/CONVENTIONS.md`).

**Parent:** [Interface](../README.md)

## Parts

- [Tokens](tokens.md): the named design values and the `--we-*` variables.
- [Themes](themes.md): a theme as settings, the three theme tiers, and where a theme reaches.
- [Primitives](primitives.md): the `we-*` Lit elements, which work in any framework.
- [Components](components.md): the Solid components, the empty widgets package, and the shared prop logic.
- [Drag](drag.md): the drag session and its payload of references.
- [Brand](brand.md): the one mark and the app icons that come from it.

<details><summary>How it works</summary>

| Layer | Package | Folder |
|---|---|---|
| 1 | `@we/tokens` | `design-system/1-tokens` |
| 2 | `@we/themes` | `design-system/2-themes` |
| 3 | `@we/primitives` | `design-system/3-primitives` |
| 4 | `@we/components` | `design-system/4-components` |
| 5 | `@we/widgets` | `design-system/5-widgets` |
| — | `@we/design-types`, `@we/design-utils`, `@we/drag` | `design-system/types`, `utils`, `drag` |

1. A schema node sets design-system props (`p`, `gap`, `bg`, `r`, `tone`, …) on any primitive or layout component. `@we/design-utils` turns these props into CSS for both layers.
2. A theme writes variables on a root. Primitives and components read these variables through roles and families, never through fixed values.
3. The renderer finds a component by name in the component registry ([Component registry](../renderer/component-registry.md)).

</details>

<details><summary>Where in the code</summary>

- [packages/design-system/](../../../packages/design-system): all the layers.
- [packages/design-system/CONVENTIONS.md](../../../packages/design-system/CONVENTIONS.md): the rules for components and widgets.
- [packages/design-system/README.md](../../../packages/design-system/README.md).
- [docs/architecture/theming.md](../../../docs/architecture/theming.md): theming in depth.

</details>
