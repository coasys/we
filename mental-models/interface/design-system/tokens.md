# Tokens

A **design token** is a named design value on a fixed scale, for example `space` `'300'` or `radius` `'400'`. Each token becomes a CSS variable named `--we-<category>-<key>`, such as `--we-space-300`. A **role** is a token that says what a colour is for, such as `surface`, `text-muted` or `accent-border`.

**Why:** A role is what a theme can change. Some relations between colours invert between light and dark, for example a raised surface gets lighter in dark. A scale position cannot express this, because the full ramp flips together, so anything with a meaning uses a role (`1-tokens/CONVENTIONS.md`). A set of plain CSS keywords is a type in `@we/design-types`, not a token.

**Parent:** [Design system](README.md)

<details><summary>How it works</summary>

1. Each category has its own file in `1-tokens/src` (`space.ts`, `color.ts`, `font.ts`, `size.ts`, `role.ts`, `z-index.ts`, …). A category exports a `*Token` type (the scale) and, where raw CSS is permitted, a `*Value` type.
2. `scripts/generate-css.ts` runs after the build and writes one CSS file per category in `dist/css`. A snapshot test holds the output.
3. `families.ts` is the one list of colour families:
   - The semantic families `accent`, `success`, `warning` and `danger` carry a meaning. Status uses them.
   - The ten palette hues (`red` … `pink`) carry no meaning. Categories use them.
   - `neutral` holds the greys.
4. Each family has seven roles: `<family>`, `on-<family>`, `<family>-soft`, `-text`, `-border`, `-hover` and `-active` (`familyRoles.ts`).
5. `tone` on an element points the accent roles inside it at one family (`toneVariables`). Components take colour from the accent roles, so they follow the tone.
6. `themeFamily.ts` holds shape and density per component family: `control`, `surface`, `input`, `avatar` and `media`. Each family reads a variable such as `--we-theme-control-radius` with a default.
7. `componentTheme.ts` builds the component chain: `componentThemeVar` names the variable, and `componentChain` reads the variant, then the component, then the fallback.

</details>

<details><summary>Where in the code</summary>

- [packages/design-system/1-tokens/src/](../../../packages/design-system/1-tokens/src): [families.ts](../../../packages/design-system/1-tokens/src/families.ts), [familyRoles.ts](../../../packages/design-system/1-tokens/src/familyRoles.ts), [role.ts](../../../packages/design-system/1-tokens/src/role.ts), [themeFamily.ts](../../../packages/design-system/1-tokens/src/themeFamily.ts), [componentTheme.ts](../../../packages/design-system/1-tokens/src/componentTheme.ts).
- [generate-css.ts](../../../packages/design-system/1-tokens/scripts/generate-css.ts).
- [packages/design-system/1-tokens/CONVENTIONS.md](../../../packages/design-system/1-tokens/CONVENTIONS.md): how to add a token or a role.
- [packages/design-system/types/src/index.ts](../../../packages/design-system/types/src/index.ts): `@we/design-types`, the CSS keyword types and `DesignSystemProps`.

</details>
