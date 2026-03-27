# Schema–Theme Integration

Bridge the schema layer with the existing CSS theme system so that schema nodes can scope theme zones to subtrees — all without replacing the CSS custom-property cascade that makes the current system performant and framework-agnostic.

> **Scope note:** Seed integration (reading `host.theme`, dynamic theme registration, `applyThemeToLauncher`) is deferred — those are whitelabel concerns. This PR focuses on letting any schema node influence theme variables for its subtree.

## Status

| Task                                                       | Status      |
| ---------------------------------------------------------- | ----------- |
| T1 — `ThemeOverrides` type + `theme` field on `SchemaNode` | Not started |
| T2 — Schema renderer applies scoped CSS variables          | Not started |

---

## Problem Statement

### Current state

The theme system works well at the CSS level but has no connection to the schema/seed layer:

- **`@we/tokens`** defines a parametric color system. Colors are derived from HSL formulas using config variables (`--we-color-multiplier`, `--we-color-subtractor`, `--we-color-saturation`, `--we-color-primary-hue`, etc.).
- **`@we/themes`** ships 5 static CSS files (light, dark, black, retro, cyberpunk) that override these parametric variables on `html[data-we-theme='...']`.
- **Schema nodes** reference tokens by name (`bg: "primary-500"`) but have no way to influence _what those tokens resolve to_ in a subtree.

This means templates and template fragments all share the same color palette — there's no way to scope a section to a different brand color without writing custom CSS.

### Design principles

1. **CSS cascade stays as the application mechanism.** No JavaScript re-renders for theme changes. The parametric color system (`multiplier`/`subtractor`) is preserved.
2. **Token scales are immutable.** Schemas can change _what colors look like_ (hue, saturation) but cannot redefine what `space-400` means. The token vocabulary is a system-wide invariant.
3. **Theme overrides are constrained to parametric variables.** Only the knobs that the CSS theme files already use are exposed to schemas.
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

For app-wide theming, set `theme` on the root template node — CSS cascade applies it to the entire app.

---

## Architecture Overview

```
Schema Node
theme: { primaryHue: 250 }
         │
         ▼
   T2: SchemaRenderer
         │
         └─► display:contents wrapper with inline style:
             --we-color-primary-hue: 250

             CSS cascade handles rest:
             all descendants inherit

Unchanged layers:
  @we/tokens   — token structure, scales, CSS generation (no changes)
  @we/themes   — built-in static themes remain as CSS files (no changes)
  Components   — consume tokens via var(--we-*) as before (no changes)
```

---

## Package Impact Summary

| Package                                   | Changes                                              |
| ----------------------------------------- | ---------------------------------------------------- |
| `@we/schema-system/shared`                | Add `ThemeOverrides` type, `theme` field on `SchemaNode` |
| `@we/schema-system/solid`                 | Apply `theme` as scoped CSS vars in `SchemaRenderer`     |

---

## Key Decisions

- **Token scales are immutable.** Schemas cannot redefine `--we-space-400` or `--we-font-600`. Only parametric color/font variables are exposed.
- **CSS cascade is the application mechanism.** No JS-side color computation. Setting `--we-color-primary-hue: 250` on an element lets CSS `hsl()` and `calc()` do the work.
- **Built-in themes stay as static CSS.** Retro's SVG scrollbars and cyberpunk's `@keyframes` cannot be expressed in JSON — nor should they be.

## Deferred

- **Seed theme consumption** (T4–T6): Reading `seed.host.theme`, dynamic theme registration, `applyThemeToLauncher`. These are whitelabel concerns — needed when someone forks WE into a branded app. Deferred until that use case materializes.
- **Runtime theme generation utility** (T3): `registerDynamicTheme()` injects a `<style>` element for app-wide themes. Not needed — users can set `theme` on the root template node for the same effect. Only useful for themes that persist across template switching (a seed/whitelabel concern).
- **`$theme` token** (T7): Exposes raw parametric values (e.g., hue as a number) to schema props. No concrete use case — components consume theme values through CSS variables. Only relevant for canvas/WebGL widgets that do their own color math.
