# Themes

A **theme** is an object of settings, not a stylesheet: a polarity and a lightness range, a hue, saturation and fill lightness for each colour family, shape and density for each component family, and type roles. `applyThemeVars(root, theme)` turns the settings into CSS variables on one root. A **theme tier** is one of three levels at which a theme speaks: system, components and CSS.

**Why:** A theme names roles and families, never the internals of a component. So a theme applies to templates that it has never seen, and a template that is written later still wears it. A theme can come from anyone, so it cannot fetch anything and it reaches only the scope where it is applied (`docs/architecture/theming.md`).

**Parent:** [Design system](README.md)

<details><summary>How it works</summary>

| Theme tier | What it says | Where it is |
|---|---|---|
| System | colour families and roles, the palette, type roles, shape and density per family | top-level settings |
| Components | one component, or one variant, apart from its family | `components.<name>[.variants.<variant>]` |
| CSS | effects that no setting expresses | the theme's `css`, against public `::part()` names |

1. A component reads its own value first, then its family's value, then its default. For a `soft` button's radius: the `radius` prop, then `--we-theme-button--soft-radius`, then `--we-theme-button-radius`, then `--we-theme-control-radius`, then the button's default.
2. `applyThemeVars` lays the person's display preferences over the theme (`withDisplay`), writes each setting, and then `deriveRoleVars` measures the result. It moves each role that the theme did not pin until it is legible, by WCAG 2 and APCA.
3. A theme reaches one of four scopes:
   - the document;
   - a space's content (`[data-we-theme-scope]`), but not the sidebar or the module rail unless the person permits it;
   - a node with a `theme` prop, through a `display: contents` wrapper that carries `data-we-theme`;
   - an element with `tone`, which re-points only the accent roles.
4. The person chooses the mode: colour scheme, contrast, text size, density and motion (`AgentSettings.displayPreferences`). The mode applies over every theme. A theme can carry `light`, `dark` and `contrast.more` blocks for those modes.
5. `sanitiseCss` removes `@import` and each `url()` that is not a `data:` URL, and namespaces `@keyframes`. A space's CSS is confined with `@scope`.
6. `parseOverrides` reads each stored theme and migrates older settings.
7. The built-in presets are `light`, `dark`, `black`, `retro` and `cyberpunk` (`THEME_PRESETS`). `themeRegistry` adds their CSS, the showcase presets in a build with developer features, and the themes of the seed's bundles.

</details>

<details><summary>Where in the code</summary>

- [packages/design-system/2-themes/src/](../../../packages/design-system/2-themes/src): [themeStyles.ts](../../../packages/design-system/2-themes/src/themeStyles.ts) (`applyThemeVars`, `deriveRoleVars`), [themeSettings.ts](../../../packages/design-system/2-themes/src/themeSettings.ts) (`THEME_SETTINGS`), [display.ts](../../../packages/design-system/2-themes/src/display.ts) (`withDisplay`, `setDisplayPreferences`), [sanitiseCss.ts](../../../packages/design-system/2-themes/src/sanitiseCss.ts), [migrate.ts](../../../packages/design-system/2-themes/src/migrate.ts) (`parseOverrides`), [presets.ts](../../../packages/design-system/2-themes/src/presets.ts).
- [themeRegistry.ts](../../../packages/app-shell/src/shared/registries/themeRegistry.ts): the themes that the app offers.
- [packages/design-system/2-themes/THEME_AUTHORING.md](../../../packages/design-system/2-themes/THEME_AUTHORING.md): how to write a theme.
- [docs/architecture/theming.md](../../../docs/architecture/theming.md), [the theme tiers decision](../../../docs/architecture/decisions/2026-10-23-theme-tiers-registries-and-modes.md).

</details>
