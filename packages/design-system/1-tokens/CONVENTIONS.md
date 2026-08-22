# Tokens — Design Conventions

Rules and patterns for adding or modifying design tokens in `@we/tokens`.

## What Is a Token?

A token is a **named design value with a curated scale** that generates CSS custom properties (`--we-*`). If a value set is just standard CSS keywords (e.g. `display: flex | block | grid`), it's a **type**, not a token — those belong in `@we/design-types`.

**Rule of thumb:** If there's a value map → token (`@we/tokens`). If it's a CSS keyword union → type (`@we/design-types`).

## File Structure

Each token category lives in its own source file under `src/`:

| File           | Tokens                                                 | CSS Prefix                                           |
| -------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| `color.ts`     | Color hues, lightness, base colors                     | `--we-color-*`                                       |
| `space.ts`     | Spacing scale                                          | `--we-space-*`                                       |
| `font.ts`      | Font family, size, weight, line-height, letter-spacing | `--we-font-*`                                        |
| `size.ts`      | Component sizes, radius, avatar sizes                  | `--we-size-*`, `--we-radius-*`, `--we-avatar-size-*` |
| `border.ts`    | Border width, color                                    | `--we-border-*`                                      |
| `shadow.ts`    | Shadow scale (the one components use via `shadow=`)    | `--we-shadow-*`                                      |
| `role.ts`      | Semantic role slots over the scale                     | `--we-role-*`                                        |
| `layout.ts`    | Layout measure widths                                  | `--we-layout-*`                                      |
| `z-index.ts`   | Stacking layers                                        | `--we-z-*`                                           |
| `animation.ts` | Transition durations                                   | `--we-transition-*`                                  |
| `component.ts` | Component-specific tokens (scrollbar)                  | `--we-scrollbar-*`                                   |

All files are re-exported through `src/index.ts`.

## Naming Conventions

### Scale Types

- **Numbered scales** (`'100'`–`'1000'`) — for continuous/metric values where relative ordering matters: spacing, font-size, radius, transition duration.
- **Named scales** (`'sm'`, `'md'`, `'lg'`) — for semantic/categorical values: component sizes, shadow presets.
- **Keyword scales** (`'tight'`, `'normal'`, `'loose'`) — for named presets with descriptive meaning: line-height, letter-spacing.
- **Special named tokens** (`'pill'`, `'full'`) — non-linear values that don't fit a numeric scale, used alongside numeric scales (e.g. radius).

### Type Naming

Every token category exports up to two types:

```ts
// The token type — only valid scale values, gives autocomplete
export type SpaceToken = '0' | '100' | '200' | ... | '1000';

// The value type — token + escape hatch for raw CSS
export type SpaceValue = SpaceToken | (string & {});
```

| Suffix   | Purpose                              | Example                                      |
| -------- | ------------------------------------ | -------------------------------------------- |
| `*Token` | Strict union of scale values         | `SpaceToken`, `FontSizeToken`, `RadiusToken` |
| `*Value` | Token + `(string & {})` escape hatch | `SpaceValue`, `ColorValue`, `RadiusValue`    |

**When to add an escape hatch (`*Value` type):**

- The property might reasonably need a raw CSS value (e.g. `padding="clamp(1rem, 2vw, 2rem)"`)
- The token scale can't cover all valid use cases (e.g. shadow, line-height)
- Other similar tokens already have one (consistency)

**When NOT to add an escape hatch:**

- The token + keyword union already covers all valid CSS values (e.g. `FontWeight = FontWeightToken | 'bold' | 'normal' | ...`)

### Value Map Naming

```ts
// Named same as the CSS property / token category
export const space = { ... };
export const fontSize = { ... };
export const fontWeight = { ... };
```

Use `satisfies Record<TokenType, string>` to enforce completeness:

```ts
export const lineHeight = {
  none: '1',
  tight: '1.25',
  normal: '1.5',
} satisfies Record<LineHeightToken, string>;
```

## Adding a New Token

1. **Define the token type** in the appropriate `src/*.ts` file.
2. **Define the value map** — a `Record<TokenType, string>` with `satisfies`.
3. **Add a Value type** if an escape hatch is needed (see rules above).
4. **Export** types and values from `src/index.ts`.
5. **Update CSS generation** in `scripts/generate-css.ts` to produce `--we-{prefix}-{key}` variables.
6. **Update helpers** in `@we/design-utils` or `@we/primitives` `helpers.ts` to call `tokenVar(prefix, value)` for the new token.
7. **Update `DesignSystemProps`** in `@we/design-types` to reference the new type.

## CSS Generation

The `scripts/generate-css.ts` script runs as a post-build hook (via tsup). It:

1. Imports compiled token maps from `dist/index.js`
2. Generates per-category CSS files in `dist/css/`
3. Creates `dist/css/index.css` as an aggregator with `@import` statements

**Naming rule:** CSS custom properties follow `--we-{category}-{key}`, e.g.:

- `--we-space-300`
- `--we-color-primary-500`
- `--we-font-size-400`
- `--we-radius-400`

## Roles vs scale positions

`color.ts` holds the **scale** — `neutral-0` … `neutral-1000`, one ramp per hue. `role.ts` holds the
**vocabulary**: `surface`, `text-muted`, `border`, `accent-text`, `danger-text`. A scale position says
which grey; a role says what the colour is *for*.

**Anything with a meaning takes a role.** Every `bg`, `color` and border colour in a template, in the
app chrome and in a feature module names a role, and `tokenVar('color', …)` resolves role names to
`--we-role-*` exactly as it resolves scale positions to `--we-color-*`, so they are interchangeable
at every call site — including inside a border shorthand and behind `$if`.

Two reasons it matters, and only the second is obvious:

1. A role is what a theme can redefine. `ThemeOverrides.roles` pins any of them; the theme editor
   exposes all of them.
2. Some relationships **invert** between light and dark and a scale position cannot express that,
   because the whole ramp flips together. A raised surface gets *lighter* in dark rather than
   casting a shadow; a rail that must stay darker than its page in both modes cannot be written as
   `neutral-100` over `neutral-50`. This is the reason roles exist, not a nicety.

**Scale positions remain right for a palette** — a graph's node colours by category, a chart series,
a user-picked swatch. A node painted `warning-100` because it is a note is not a warning, and
nothing about a theme should recolour it as one. Those are the only scale positions left in the
templates, deliberately.

Colours may be written in `oklch()` anywhere a colour is accepted; it is parsed and converted to
sRGB like any other notation. The *ramps* are still HSL — moving those is a separate decision that
changes how every theme looks — but an author pasting a value from a modern palette tool should not
be told it is unparseable, and OKLCH is the space in which a contrast check would like to reason.

When adding a role, give it a parametric default over the scale so every existing theme keeps
working untouched, and say in its doc comment what relationship it exists to express — if the answer
is only "a slightly different grey", it is a scale position and does not belong here.

### Four ways to pin one, and what each survives

A theme overrides a role by giving it a value, and *which kind* of value decides how much of the
theme still reaches it afterwards. In descending order of how much survives:

| Written as | Survives | Use for |
| --- | --- | --- |
| unset | everything | the default; the role follows the scale |
| `var(--we-color-neutral-200)` | hue, saturation, light/dark polarity | "surfaces sit two steps down" — most theme edits mean this |
| `oklch(22.7% calc(min(var(--we-color-neutral-saturation) * 0.0035, 0.18) * 0.454) var(--we-color-neutral-hue))` | hue and saturation; holds its lightness against a polarity flip | a designed theme whose surface ramp is uneven — `channels`, `timeline` |
| `color-mix(in srgb, var(--we-role-surface) 88%, var(--we-role-text))` | everything, *including a later change to the role it references* | "a step darker than the surface" — a relationship rather than a value |
| `oklch(from var(--we-role-page) calc(l + 0.045) c h)` | the same, and stays an even step at any lightness or hue | "one step above the page" — how the elevation stack is written |
| `#1a1a1e` | nothing | a brand colour that must not move |

The two relative rows are worth reading twice: they are the only forms that express a *relationship*
rather than a value, so it survives a change to the role it names — and because it mixes toward a
role that inverts with the theme, "a step darker" in a light theme becomes "a step lighter" in a
dark one without being told. The secondary button's hover and pressed states are written this way,
which is why they need no roles of their own.

The `oklch(from …)` row is the stronger of the two and is why the elevation stack is written that
way. `color-mix` interpolates *between two colours*, so a fixed percentage moves by a share of the
distance remaining — 8% toward white is 0.4 lightness points from a near-white page and 7 from a
dark one. `calc(l + n)` in OKLCH moves by a fixed *perceptual* amount instead, which is the only
thing that means the same in a light theme and a dark one. It also carries `c` and `h` through, so
a theme that tints its neutrals gets a tinted stack without saying so.

The ramp itself is OKLCH too, for the same reason at a different scale. Under HSL a step was a
*coordinate*, so the same "500" landed at L* 46 for blue and L* 69 for green — a 39-point swing
across the hue slider at one nominal step, which meant changing a hue silently changed how heavy the
accent read, and the three status *text* roles had to sit at three different steps to compensate.
They share one step now.

Two consequences worth knowing when writing a theme by hand:

- **A hue is an OKLCH angle**, which is not the HSL angle for the same colour — 220 (blue) is 263,
  and 45 (amber) is 90. `migrate.ts` converts stored themes; a number typed fresh is an OKLCH angle.
- **Saturation is a plain 0–100 number**, not a percentage, because it scales an absolute chroma
  rather than expressing a proportion. It is capped: sRGB runs out of colour before OKLCH does, and
  past the boundary the browser gamut-maps — which is how `saturation: 85` on a blue once produced a
  magenta accent.

The last row is the only one that really leaves the system, and it is the one a colour picker
produces by default — which is why `we-color-picker` opens on the **token grid** when `tokens` is
set, and why the theme editor names the rung each role is on rather than showing a swatch and
leaving you to guess.

Two roles are deliberately written the third way in `role.ts` itself: `surfaceInverse` and
`onInverse`. A tooltip has to stay opposite to the page in *both* polarities, and no expression
over the scale can do that, because the whole ramp inverts together.

## Runtime Consumption

Tokens are consumed at runtime via two mechanisms in `@we/design-utils`:

### `tokenVar()` — for most props

```ts
tokenVar('space', '300'); // → 'var(--we-space-300)'
tokenVar('color', '#ff0000'); // → '#ff0000' (raw CSS passthrough)
tokenVar('space', undefined); // → '0' (fallback)
```

Raw CSS values (hex, px, rem, %, rgba, `auto`, `none`, etc.) are detected by `isRawCSSValue()` and passed through unchanged. Named tokens become CSS variable references.

Use `tokenVar()` when raw CSS values for that prop are **syntactically distinguishable** from token keys — i.e. they contain units, `#`, `var()`, or known keywords. This covers `color`, `space`, `fontSize`, `radius`, `letterSpacing`, `shadow`, etc.

### `makeTokenResolver()` — for ambiguous props

Some props have token keys that are syntactically identical to valid raw CSS values (bare numbers, CSS keywords without units). `isRawCSSValue()` cannot distinguish them, so `tokenVar()` would silently generate a non-existent CSS variable.

For these props, use `makeTokenResolver()` to build a dedicated resolver that checks the exact set of valid token keys:

```ts
// In utils/src/index.ts:
const resolveLineHeight = makeTokenResolver(
  new Set(['none', 'tight', 'snug', 'normal', 'relaxed', 'loose']),
  'line-height',
);
// resolveLineHeight('normal')  → 'var(--we-line-height-normal)'
// resolveLineHeight('1.6')     → '1.6'   (raw passthrough)
// resolveLineHeight('2')       → '2'     (raw passthrough — works, unlike tokenVar)
// resolveLineHeight('24px')    → '24px'  (raw passthrough)
```

**Current props using `makeTokenResolver`:**

| Prop         | Token keys                                            | Why not tokenVar?                                                              |
| ------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `lineHeight` | `none`, `tight`, `snug`, `normal`, `relaxed`, `loose` | Bare number ratios (`1.6`, `2`) are indistinguishable from integer token keys  |
| `fontWeight` | `'100'`–`'900'`                                       | CSS keywords (`bold`, `normal`, `bolder`, `lighter`) are strings without units |

**Rule:** Any new token prop whose raw CSS escape hatch values are bare strings or numbers (no units, no `#`, no `var()`) should use `makeTokenResolver` instead of `tokenVar`.
