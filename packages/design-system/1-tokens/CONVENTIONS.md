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
| `effect.ts`    | Depth/shadow presets                                   | `--we-depth-*`                                       |
| `animation.ts` | Transition durations                                   | `--we-transition-*`                                  |
| `component.ts` | Component-specific tokens (scrollbar)                  | `--we-scrollbar-*`                                   |

All files are re-exported through `src/index.ts`.

## Naming Conventions

### Scale Types

- **Numbered scales** (`'100'`–`'1000'`) — for continuous/metric values where relative ordering matters: spacing, font-size, transition duration.
- **Named scales** (`'sm'`, `'md'`, `'lg'`) — for semantic/categorical values: component sizes, radius, shadow presets.
- **Keyword scales** (`'tight'`, `'normal'`, `'loose'`) — for named presets with descriptive meaning: line-height, letter-spacing.

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
- `--we-radius-md`

## Runtime Consumption

Tokens are consumed at runtime via `tokenVar()` from `@we/design-utils`:

```ts
tokenVar('space', '300'); // → 'var(--we-space-300)'
tokenVar('color', '#ff0000'); // → '#ff0000' (raw CSS passthrough)
tokenVar('space', undefined); // → '0' (fallback)
```

Raw CSS values (hex, px, rem, %, rgba, etc.) are detected by `isRawCSSValue()` and passed through unchanged. Named tokens become CSS variable references.
