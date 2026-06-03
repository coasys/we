# Themes — Design Conventions

Rules and patterns for adding or modifying visual themes in `@we/themes`.

## What Is a Theme?

A theme is a **CSS stylesheet** that overrides design tokens and applies visual effects (clip-paths, animations, box-shadows, etc.) to primitives via `::part()` selectors. Themes are activated by the `data-we-theme` attribute on a DOM element — all descendants inherit the theme.

Themes can be applied at any level:

- **Root level** — `<html data-we-theme="dark">` for app-wide theming.
- **Scoped level** — on any descendant element via the schema system's `theme.themeName` property, enabling different themes on different parts of the UI simultaneously.

## File Structure

Each theme lives in its own directory under `src/`:

```
src/
├── index.css          ← aggregator (@import for each theme)
├── dark/index.css
├── black/index.css
├── retro/index.css
└── cyberpunk/index.css
```

The aggregator `src/index.css` imports all themes:

```css
@import url('./dark/index.css');
@import url('./black/index.css');
@import url('./retro/index.css');
@import url('./cyberpunk/index.css');
```

## Adding a New Theme

1. Create `src/{theme-name}/index.css`.
2. Add `@import url('./{theme-name}/index.css');` to `src/index.css`.
3. Follow all conventions below.
4. Run `pnpm --filter @we/themes build` to produce `dist/`.

## Selector Convention

**Always use `[data-we-theme='name']`** — never prefix with `html` or any other element.

```css
/* ✅ Correct — matches at any DOM level */
[data-we-theme='cyberpunk'] { ... }
[data-we-theme='cyberpunk'] we-button::part(base) { ... }

/* ❌ Wrong — only matches when attribute is on <html> */
html[data-we-theme='cyberpunk'] { ... }
```

Scoped themes set the attribute on a `<div>` wrapper, so `html`-prefixed selectors won't match.

## Required: Self-Contained Color System

Every theme **must** declare the full set of color system input variables. This prevents parent theme values from bleeding through when themes are scoped to a subtree.

```css
[data-we-theme='my-theme'] {
  /* ── Required color system variables ── */
  --we-color-multiplier: 1; /* 1 = light mode, -1 = dark mode */
  --we-color-subtractor: 0%; /* 0% = light mode, 100%+ = dark mode */
  --we-color-saturation: 60%; /* Main color family saturation */
  --we-color-neutral-saturation: 10%; /* Neutral color saturation */
}
```

| Variable                        | Light-mode default | Dark-mode default | Purpose                                       |
| ------------------------------- | ------------------ | ----------------- | --------------------------------------------- |
| `--we-color-multiplier`         | `1`                | `-1`              | Inverts lightness scale                       |
| `--we-color-subtractor`         | `0%`               | `100%`–`110%`     | Shifts lightness baseline                     |
| `--we-color-saturation`         | `60%`              | `50%`             | Saturation for primary/success/warning/danger |
| `--we-color-neutral-saturation` | `10%`              | `20%`             | Saturation for neutral greys                  |

Without these, a scoped theme inherits whatever the parent context has set — e.g. a light retro theme inside a dark app would show dark colors.

### Optional color inputs

These are inherited from `:root` if not set, which is usually fine:

```css
--we-color-primary-hue: 270; /* Override the primary hue */
/* success, warning, danger hues are rarely overridden by themes */
```

## Never Use `!important` on Overridable Variables

The schema system supports inline parametric overrides via `theme: { primaryHue: 180, saturation: '70%' }`. These are applied as inline styles, which `!important` in CSS will defeat.

```css
/* ❌ Wrong — blocks schema overrides */
[data-we-theme='retro'] {
  --we-color-primary-hue: 230 !important;
  --we-font-family: monospace !important;
}

/* ✅ Correct — schema overrides can take precedence */
[data-we-theme='retro'] {
  --we-color-primary-hue: 230;
  --we-font-family: monospace;
}
```

**When is `!important` acceptable?** Only on `::part()` styling for web component internals where specificity wars require it — never on CSS custom properties that the schema system may override.

## Theme File Structure

A theme file should be organized in two sections:

### 1. Base Variables

Token overrides on the `[data-we-theme]` selector:

```css
[data-we-theme='my-theme'] {
  /* Color system (required) */
  --we-color-multiplier: -1;
  --we-color-subtractor: 110%;
  --we-color-saturation: 60%;
  --we-color-neutral-saturation: 10%;

  /* Optional overrides */
  --we-color-primary-hue: 180;
  --we-font-family: monospace;
  --we-border-radius: 0px;
  --we-border-color: var(--we-color-primary-200);
  --we-size-sm: 30px;
  --we-size-md: 40px;
  --we-size-lg: 50px;
}
```

### 2. Component Overrides

Visual effects on primitive `::part()` selectors for properties not covered by design tokens (clip-paths, animations, box-shadows, pseudo-elements):

```css
[data-we-theme='my-theme'] we-button::part(base) {
  clip-path: polygon(...);
}

[data-we-theme='my-theme'] we-button:hover {
  animation-name: glitch;
}
```

## Reference Colors via Variables

When referencing colors in component overrides, use CSS custom properties rather than hardcoded values. This ensures colors respond to schema overrides:

```css
/* ✅ Correct — adapts to primaryHue overrides */
border-color: var(--we-color-primary-200);
background: var(--we-color-neutral-50);

/* ❌ Avoid — hardcoded colors don't respond to overrides */
border-color: #00ffcc;
background: #1a1a2e;
```

Exception: theme-specific accent colors that intentionally don't follow the token system (e.g. retro's `silver` background).

## Build

Themes are built with PostCSS:

```bash
pnpm --filter @we/themes build
```

This produces `dist/` with per-theme CSS files and a combined `dist/index.css`. After modifying source CSS, always rebuild — the app imports from `dist/`.
