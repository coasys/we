# Plan: Rename `color-ui` → `color-neutral`

> Rename the `ui` color family to `neutral` across the entire design system and schema layer. No deprecation aliases — no external consumers exist. Clean, atomic rename.

---

## Context

The `ui` color family is the low-saturation scale used for surfaces, backgrounds, borders, and text. The name "ui" is ambiguous — every color in the system is used in UI. Industry convention is `neutral` or `gray` (Tailwind, Radix, Shadcn, Open Props all use these terms).

Renaming now is cheap:

- No published API consumers — `ThemeOverrides`, `@we/tokens`, and `@we/design-system` are all internal.
- The `color-ui` tokens were just wired into the schema-theme system (PR #3) but haven't shipped.
- A clean rename avoids carrying a confusing name into every future template, component, and theme file.

---

## Scope

### What changes

| Layer                 | Old                                             | New                                                       |
| --------------------- | ----------------------------------------------- | --------------------------------------------------------- |
| CSS custom properties | `--we-color-ui-*`                               | `--we-color-neutral-*`                                    |
| CSS config variables  | `--we-color-ui-hue`, `--we-color-ui-saturation` | `--we-color-neutral-hue`, `--we-color-neutral-saturation` |
| JS token type         | `ColorHueToken: 'ui'`                           | `ColorHueToken: 'neutral'`                                |
| JS token object       | `color.hues.ui`                                 | `color.hues.neutral`                                      |
| JS config             | `color.config.uiSaturation`                     | `color.config.neutralSaturation`                          |
| ThemeOverrides fields | `uiHue`, `uiSaturation`                         | `neutralHue`, `neutralSaturation`                         |
| Zod schema            | `zThemeOverrides.uiHue`, `.uiSaturation`        | `.neutralHue`, `.neutralSaturation`                       |
| themeStyles.ts        | `THEME_CSS_MAP.uiHue`, `FAMILY_SAT_VAR.ui`      | `THEME_CSS_MAP.neutralHue`, `FAMILY_SAT_VAR.neutral`      |
| CSS generation script | `ui` family references                          | `neutral` family references                               |
| Theme CSS files       | `--we-color-ui-*` overrides                     | `--we-color-neutral-*` overrides                          |
| Component CSS         | `var(--we-color-ui-*)` references               | `var(--we-color-neutral-*)` references                    |

### What does NOT change

- Token scale values (lightness steps, hue numbers, saturation percentages)
- The relationship `neutral-hue` inherits from `primary-hue`
- Color families: primary, success, warning, danger remain unchanged
- `--we-color-white` / `--we-color-black` — these reference the neutral scale but the alias names stay

---

## Implementation

### T1 — Rename JS tokens

**Package:** `@we/tokens`

1. `packages/design-system/1-tokens/src/color.ts`:
   - Rename `ColorHueToken` union member `'ui'` → `'neutral'`
   - Rename `color.hues.ui` → `color.hues.neutral`
   - Rename `color.config.uiSaturation` → `color.config.neutralSaturation`

2. Update any type re-exports in `index.ts`

### T2 — Rename CSS generation

**Package:** `@we/design-system` (1-tokens)

1. `packages/design-system/1-tokens/scripts/generate-css.ts`:
   - Change `ui` family name to `neutral` in all output lines
   - `--we-color-ui-hue` → `--we-color-neutral-hue`
   - `--we-color-ui-saturation` → `--we-color-neutral-saturation`
   - `--we-color-ui-{step}` → `--we-color-neutral-{step}`
   - Keep `--we-color-white` / `--we-color-black` referencing `--we-color-neutral-*`

2. Regenerate `dist/css/color.css`

### T3 — Rename in theme CSS files

**Package:** `@we/themes`

Update all 5 theme files (light, dark, black, retro, cyberpunk) — find/replace `--we-color-ui-` → `--we-color-neutral-`.

### T4 — Rename in component CSS

**Packages:** `@we/design-system` primitives, any component using `var(--we-color-ui-*)`

Global find/replace across all `.css` and `.ts` files in the design-system and component packages:

- `--we-color-ui-` → `--we-color-neutral-`
- `color-ui-hue` → `color-neutral-hue`
- `color-ui-saturation` → `color-neutral-saturation`

### T5 — Rename in schema-theme layer

**Package:** `@we/schema-shared`

1. `types.ts` — `ThemeOverrides`:
   - `uiHue` → `neutralHue`
   - `uiSaturation` → `neutralSaturation`

2. `zodSchemas.ts` — `zThemeOverrides`:
   - Same field renames

3. `themeStyles.ts`:
   - `THEME_CSS_MAP`: rename keys and CSS variable values
   - `FAMILY_SAT_VAR`: `ui` → `neutral`
   - Update ui-hue linkage comment to reference `neutral-hue`

### T6 — Update any template/seed references

Search for any `uiHue` or `uiSaturation` in template schemas (weNativeApp.ts, etc.) and rename.

---

## Verification

1. `pnpm --filter @we/tokens build` — type check passes
2. `pnpm --filter @we/design-system build` — CSS regenerated correctly
3. `pnpm --filter @we/schema-shared build && pnpm --filter @we/schema-solid build` — clean
4. `pnpm --filter @we/schema-shared test && pnpm --filter @we/schema-solid test` — all pass
5. Global grep for `color-ui` — zero hits (excluding git history)
6. Visual: `pnpm dev:electron` — app looks identical (same colors, same theme switching)

---

## Risk

**Low.** Purely mechanical rename. No logic changes, no new features. The only risk is a missed reference — mitigated by global grep verification in step 5.
