# Schema–Theme Integration

Bridge the seed/schema layer with the existing CSS theme system so that seeds can define brand parameters, schemas can scope theme zones to subtrees, and custom themes appear in the theme switcher — all without replacing the CSS custom-property cascade that makes the current system performant and framework-agnostic.

## Status

| Task                                                       | Status      |
| ---------------------------------------------------------- | ----------- |
| T1 — `ThemeOverrides` type + `theme` field on `SchemaNode` | Not started |
| T2 — Schema renderer applies scoped CSS variables          | Not started |
| T3 — Runtime theme generation utility                      | Not started |
| T4 — Seed theme consumption in `initializeIntegrations`    | Not started |
| T5 — Dynamic theme registration in `themeRegistry`         | Not started |
| T6 — Implement `applyThemeToLauncher`                      | Not started |
| T7 — `$theme` token in schema prop resolver (stretch)      | Not started |

---

## Problem Statement

### Current state

The theme system works well at the CSS level but has no connection to the schema/seed layer:

- **`@we/tokens`** defines a parametric color system. Colors are derived from HSL formulas using config variables (`--we-color-multiplier`, `--we-color-subtractor`, `--we-color-saturation`, `--we-color-primary-hue`, etc.).
- **`@we/themes`** ships 5 static CSS files (light, dark, black, retro, cyberpunk) that override these parametric variables on `html[data-we-theme='...']`.
- **Schema nodes** reference tokens by name (`bg: "primary-500"`) but have no way to influence _what those tokens resolve to_ in a subtree.
- **Seed types** already declare `host.theme.colors` and `host.theme.fonts` but nothing reads them — `initializeIntegrations()` skips theme entirely, `applyThemeToLauncher()` is a stub that returns its input unchanged.
- **`themeRegistry`** is hardcoded — no way to register themes at runtime from a seed.

This means every WE deployment looks identical unless someone writes new CSS theme files by hand.

### Design principles

1. **CSS cascade stays as the application mechanism.** No JavaScript re-renders for theme changes. The parametric color system (`multiplier`/`subtractor`) is preserved.
2. **Token scales are immutable.** Schemas can change _what colors look like_ (hue, saturation) but cannot redefine what `space-400` means. The token vocabulary is a system-wide invariant.
3. **Theme overrides are constrained to parametric variables.** Only the knobs that the CSS theme files already use are exposed to schemas/seeds.
4. **Built-in themes remain static CSS.** Exotic themes (retro clip-paths, cyberpunk animations) need capabilities only CSS provides. These stay in `@we/themes` as authored files.

---

## T1 — `ThemeOverrides` Type + `theme` Field on `SchemaNode`

**Goal:** Define a constrained type for theme overrides and add an optional `theme` field to schema nodes.

**Package:** `@we/schema-system` (shared)

### Type definition

Add to `schema-system/shared/src/types.ts`:

```typescript
export type ThemeOverrides = {
  primaryHue?: number;
  successHue?: number;
  warningHue?: number;
  dangerHue?: number;
  uiHue?: number;
  saturation?: string; // e.g. "70%"
  uiSaturation?: string;
  multiplier?: number; // 1 or -1
  subtractor?: string; // e.g. "108%"
  fontFamily?: string;
};
```

Extend `SchemaNode`:

```typescript
type SchemaNode = {
  type?: string;
  props?: Record<string, SchemaProp>;
  theme?: ThemeOverrides; // NEW — scoped theme parameters
  slots?: Record<string, SchemaNode>;
  slot?: string;
  routes?: RouteSchema[];
  children?: (SchemaNode | string)[];
};
```

### Validation

`ThemeOverrides` is intentionally narrow. No arbitrary `--we-*` keys, no token-scale overrides. The fields map 1:1 to existing CSS custom properties:

| Field          | CSS variable               |
| -------------- | -------------------------- |
| `primaryHue`   | `--we-color-primary-hue`   |
| `successHue`   | `--we-color-success-hue`   |
| `warningHue`   | `--we-color-warning-hue`   |
| `dangerHue`    | `--we-color-danger-hue`    |
| `uiHue`        | `--we-color-ui-hue`        |
| `saturation`   | `--we-color-saturation`    |
| `uiSaturation` | `--we-color-ui-saturation` |
| `multiplier`   | `--we-color-multiplier`    |
| `subtractor`   | `--we-color-subtractor`    |
| `fontFamily`   | `--we-font-family`         |

---

## T2 — Schema Renderer Applies Scoped CSS Variables

**Goal:** When a `SchemaNode` has a `theme` field, the renderer sets the corresponding CSS custom properties as inline styles on that element. CSS cascade handles the rest — all descendants inherit the overridden values.

**Package:** `@we/schema-system` (solid)

### Implementation

In `SchemaRenderer.tsx`, after resolving props and before rendering the element:

```typescript
function themeToStyle(theme: ThemeOverrides): Record<string, string> {
  const map: Record<keyof ThemeOverrides, string> = {
    primaryHue: '--we-color-primary-hue',
    successHue: '--we-color-success-hue',
    warningHue: '--we-color-warning-hue',
    dangerHue: '--we-color-danger-hue',
    uiHue: '--we-color-ui-hue',
    saturation: '--we-color-saturation',
    uiSaturation: '--we-color-ui-saturation',
    multiplier: '--we-color-multiplier',
    subtractor: '--we-color-subtractor',
    fontFamily: '--we-font-family',
  };
  const style: Record<string, string> = {};
  for (const [key, cssVar] of Object.entries(map)) {
    const val = theme[key as keyof ThemeOverrides];
    if (val !== undefined) style[cssVar] = String(val);
  }
  return style;
}
```

Merge the result into the element's `style` alongside any existing inline styles.

### Example

```json
{
  "type": "Column",
  "theme": { "primaryHue": 250, "saturation": "70%" },
  "children": [
    { "type": "we-button", "props": { "bg": "primary-500" }, "children": ["Purple button"] },
    { "type": "we-button", "props": { "bg": "primary-500" }, "children": ["Also purple"] }
  ]
}
```

Renders as:

```html
<div style="--we-color-primary-hue: 250; --we-color-saturation: 70%">
  <we-button bg="primary-500">Purple button</we-button>
  <we-button bg="primary-500">Also purple</we-button>
</div>
```

Both buttons get the purple palette. Outside this subtree, `primary-500` retains its original hue.

---

## T3 — Runtime Theme Generation Utility

**Goal:** A small utility that takes a theme config object and injects a `<style>` element with CSS variable overrides scoped to a `data-we-theme` value.

**Package:** `@we/themes` or `@we/design-system-utils`

### API

```typescript
export function registerDynamicTheme(themeId: string, config: ThemeOverrides): void {
  const cssVars = themeToStyle(config); // reuse mapping from T2
  const rules = Object.entries(cssVars)
    .map(([prop, val]) => `  ${prop}: ${val};`)
    .join('\n');

  const css = `html[data-we-theme='${CSS.escape(themeId)}'] {\n${rules}\n}`;

  let el = document.getElementById(`we-theme-${themeId}`);
  if (!el) {
    el = document.createElement('style');
    el.id = `we-theme-${themeId}`;
    document.head.appendChild(el);
  }
  el.textContent = css;
}
```

### Notes

- Uses `CSS.escape()` on the theme ID to prevent injection via crafted theme names.
- Idempotent — calling twice with the same ID updates rather than duplicates.
- Generated themes work identically to static themes: `ThemeStore.setCurrentTheme('my-brand')` just works.

---

## T4 — Seed Theme Consumption in `initializeIntegrations`

**Goal:** Read `seed.host.theme` during app initialization and apply it.

**Package:** `@we/app-framework`

### Changes to `initializeIntegrations.ts`

```typescript
if (seed.host?.theme) {
  const { colors, fonts } = seed.host.theme;
  const overrides: ThemeOverrides = {};

  // Map seed color names to parametric hues
  if (colors?.primary) overrides.primaryHue = parseHue(colors.primary);
  if (colors?.success) overrides.successHue = parseHue(colors.success);
  if (colors?.warning) overrides.warningHue = parseHue(colors.warning);
  if (colors?.danger) overrides.dangerHue = parseHue(colors.danger);

  if (fonts?.family) overrides.fontFamily = fonts.family;

  registerDynamicTheme('seed', overrides);
}
```

### Seed type update

Align `seed.ts` `host.theme` with the parametric system — consider extending the type to accept hue values directly in addition to hex colors (with a `parseHue` helper that extracts hue from hex/HSL strings).

---

## T5 — Dynamic Theme Registration in `themeRegistry`

**Goal:** Allow runtime registration of themes so seed-defined themes appear in the theme switcher UI.

**Package:** `@we/app-framework`

### Changes to `themeRegistry.ts`

Convert from a frozen object to a mutable registry with a registration function:

```typescript
const _themes: Record<string, ThemeEntry> = {
  light: { name: 'Light', icon: 'sun' },
  dark: { name: 'Dark', icon: 'moon' },
  black: { name: 'Black', icon: 'square' },
  retro: { name: 'Retro', icon: 'floppy-disk' },
  cyberpunk: { name: 'Cyberpunk', icon: 'cpu' },
};

export function registerTheme(id: string, entry: ThemeEntry): void {
  _themes[id] = entry;
}

export function getThemeRegistry(): Readonly<Record<string, ThemeEntry>> {
  return _themes;
}

export type ThemeKey = string; // Was: keyof typeof themeRegistry

export function isValidThemeKey(key: string): key is ThemeKey {
  return key in _themes;
}
```

### Integration

In `initializeIntegrations`, after calling `registerDynamicTheme()`:

```typescript
registerTheme('seed', {
  name: seed.project?.name ?? 'Custom',
  icon: 'palette',
});
```

The theme now appears in AppSettings alongside built-in themes.

---

## T6 — Implement `applyThemeToLauncher`

**Goal:** Replace the placeholder stub in `integrationComposer.ts` with a real implementation that injects seed theme parameters into the template's root node.

**Package:** `@we/app-framework`

### Implementation

```typescript
export function applyThemeToLauncher(template: TemplateSchema, seed: WeSeedFile): TemplateSchema {
  if (!seed.host?.theme) return template;

  const themeOverrides = seedThemeToOverrides(seed.host.theme);
  if (Object.keys(themeOverrides).length === 0) return template;

  return {
    ...template,
    theme: themeOverrides, // SchemaNode.theme — renderer applies as scoped CSS vars
  };
}
```

This means the entire template subtree inherits the seed's brand colors. Individual schema nodes can still override further via their own `theme` field.

---

## T7 — `$theme` Token in Schema Prop Resolver (Stretch)

**Goal:** Allow schema props to reference seed theme values directly, for cases where a component needs the raw brand color value rather than a token.

**Package:** `@we/schema-system` (shared)

### Syntax

```json
{
  "type": "we-text",
  "props": {
    "color": { "$theme": "primaryHue" }
  }
}
```

### Resolution

Add a case in `resolveProp()` dispatcher:

```typescript
if ('$theme' in value) {
  const themeKey = value['$theme'] as keyof ThemeOverrides;
  // Look up current theme overrides from context/store
  return currentTheme[themeKey];
}
```

### Open questions

- Where does the "current theme" live for the resolver? It could be a context-injected store, or derived from the nearest ancestor's `theme` field.
- Is this actually needed? Components already consume theme values _through_ CSS variables. The main use case would be passing a hue value as a _prop_ to a component that does its own color math (e.g., a canvas/WebGL widget).
- Marked as stretch — implement only if a concrete use case surfaces.

---

## Architecture Overview

```
Seed                              Schema Node
host.theme.colors.primary         theme: { primaryHue: 250 }
         │                                  │
         ▼                                  ▼
   T4: initializeIntegrations       T2: SchemaRenderer
         │                                  │
         ├─► T3: registerDynamicTheme       ├─► inline style:
         │   → <style> html[data-we-        │   --we-color-primary-hue: 250
         │     theme='seed'] { ... }        │
         │                                  │
         ├─► T5: registerTheme('seed')      │  CSS cascade handles rest:
         │   → appears in theme switcher    │  all descendants inherit
         │                                  │
         └─► T6: applyThemeToLauncher       │
             → template.theme = overrides ──┘

Unchanged layers:
  @we/tokens   — token structure, scales, CSS generation (no changes)
  @we/themes   — built-in static themes remain as CSS files (no changes)
  Components   — consume tokens via var(--we-*) as before (no changes)
```

---

## Package Impact Summary

| Package                                   | Changes                                                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `@we/schema-system/shared`                | Add `ThemeOverrides` type, `theme` field on `SchemaNode`                                                       |
| `@we/schema-system/solid`                 | Apply `theme` as scoped CSS vars in `SchemaRenderer`                                                           |
| `@we/themes` or `@we/design-system-utils` | Add `registerDynamicTheme()` utility                                                                           |
| `@we/app-framework`                       | Wire up seed theme in `initializeIntegrations`, implement `applyThemeToLauncher`, make `themeRegistry` dynamic |
| `@we/tokens`                              | No changes                                                                                                     |
| `@we/themes` (CSS files)                  | No changes                                                                                                     |
| `@we/primitives`                          | No changes                                                                                                     |

---

## Key Decisions

- **Token scales are immutable.** Schemas cannot redefine `--we-space-400` or `--we-font-600`. Only parametric color/font variables are exposed.
- **CSS cascade is the application mechanism.** No JS-side color computation. Setting `--we-color-primary-hue: 250` on an element lets CSS `hsl()` and `calc()` do the work.
- **Built-in themes stay as static CSS.** Retro's SVG scrollbars and cyberpunk's `@keyframes` cannot be expressed in JSON — nor should they be.
- **`$theme` token is stretch.** Components already consume theme values through CSS variables. The `$theme` token only makes sense for edge cases (canvas/WebGL) and shouldn't block the rest.
