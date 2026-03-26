# Plan: Token Type Consolidation

> Move design-scale types from `@we/design-types` to `@we/tokens` where they represent token values, not CSS keyword enums.

---

## Problem

`@we/design-types` currently mixes two categories of types:

1. **CSS keyword enums** — `Display`, `FlexDirection`, `Cursor`, `Position`, `Overflow`, `TextDecoration`, `TextTransform`, `Placement`. These are standard CSS value sets with no design-system-specific scale.

2. **Design scale types** — `FontWeight` (numeric `'100'`–`'900'` + keyword aliases). These represent the same kind of curated design scale as `FontSizeToken`, `SpaceValue`, `ColorValue`, and `RadiusValue` — all of which already live in `@we/tokens`.

This creates inconsistency: `fontSize` references `FontSizeToken` from `@we/tokens`, but `fontWeight` references `FontWeight` defined locally in `@we/design-types`. The existing TODO comment in the types file acknowledges this for fontWeight, lineHeight, letterSpacing, shadow, opacity, and zIndex.

## Guiding Principle

**If there's a value map that generates CSS custom properties, it's a token. If it's just a union of CSS keywords, it's a type.**

## Current state

| Type | Currently in | Has value map? | Should move? |
|------|-------------|----------------|--------------|
| `FontWeight` | design-types | No (raw passthrough) | **Yes** — define `FontWeightToken` + value map in tokens |
| `LineHeight` | design-types (as `string`) | No | **Yes** — define `LineHeightToken` + value map |
| `LetterSpacing` | design-types (as `string`) | No | **Yes** — define `LetterSpacingToken` + value map |
| `Shadow` | design-types (as `string`) | No | **Yes** — define `ShadowToken` + value map |
| `Opacity` | design-types (as `number`) | No | **Maybe** — only if a fixed scale is useful |
| `ZIndex` | design-types (as `number`) | No | **Maybe** — if named layers defined (`dropdown`, `modal`, `tooltip`) |
| `Border` | design-types (as `string`) | No | **Maybe** — only if preset border styles are defined |
| `Display` | design-types | No (CSS enum) | No |
| `FlexDirection` | design-types | No (CSS enum) | No |
| `Cursor` | design-types | No (CSS enum) | No |
| All other CSS enums | design-types | No | No |

## Implementation

### 1. Font Weight tokens (`@we/tokens`)

Add to `font.ts`:

```ts
export type FontWeightToken = '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';

export const fontWeight = {
  '100': '100',
  '200': '200',
  '300': '300',
  '400': '400',
  '500': '500',
  '600': '600',
  '700': '700',
  '800': '800',
  '900': '900',
} satisfies Record<FontWeightToken, string>;
```

Export `FontWeightToken` from `@we/tokens` index. Add `weight` to the `font` export.

Update `@we/design-types`:

```ts
import type { FontWeightToken } from '@we/tokens';
export type FontWeight = FontWeightToken | 'light' | 'normal' | 'medium' | 'bold' | 'bolder';
```

### 2. Line Height tokens (`@we/tokens`)

New file or addition to `font.ts`:

```ts
export type LineHeightToken = 'none' | 'tight' | 'snug' | 'normal' | 'relaxed' | 'loose';

export const lineHeight = {
  none: '1',
  tight: '1.25',
  snug: '1.375',
  normal: '1.5',
  relaxed: '1.625',
  loose: '2',
} satisfies Record<LineHeightToken, string>;
```

Update `DesignSystemProps.lineHeight` from `string` to `LineHeightToken`.

### 3. Letter Spacing tokens (`@we/tokens`)

```ts
export type LetterSpacingToken = 'tighter' | 'tight' | 'normal' | 'wide' | 'wider' | 'widest';

export const letterSpacing = {
  tighter: '-0.05em',
  tight: '-0.025em',
  normal: '0',
  wide: '0.025em',
  wider: '0.05em',
  widest: '0.1em',
} satisfies Record<LetterSpacingToken, string>;
```

Update `DesignSystemProps.letterSpacing` from `string` to `LetterSpacingToken`.

### 4. Shadow tokens (`@we/tokens`)

New file `shadow.ts`:

```ts
export type ShadowToken = 'sm' | 'md' | 'lg' | 'xl';

export const shadow = {
  sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
  md: '0 4px 6px rgba(0, 0, 0, 0.1)',
  lg: '0 10px 15px rgba(0, 0, 0, 0.1)',
  xl: '0 20px 25px rgba(0, 0, 0, 0.15)',
} satisfies Record<ShadowToken, string>;
```

Update `DesignSystemProps.shadow` from `string` to `ShadowToken`.

### 5. Update helpers pipeline

For each new token type, update `helpers.ts` to call `tokenVar()` or the appropriate lookup when setting CSS custom properties. Currently `fontWeight` is set as a raw value — after tokenization it should resolve through the token map.

### 6. Deferred (evaluate later)

- **Opacity** — CSS opacity is `0`–`1` float. A token scale (e.g. `0`, `10`, `20`, ..., `100`) adds indirection without clear benefit. Keep as `number` unless a design review requests it.
- **ZIndex** — Naming layers (`dropdown: 100`, `modal: 200`, `tooltip: 300`) is useful but requires agreement on the layer stack. Add when the component library has enough overlapping z-index concerns.
- **Border** — Preset border tokens (`'subtle'`, `'strong'`) only make sense if the design system defines a border vocabulary. Add when patterns emerge from Component Library Expansion (#10).

## Files changed

| File | Change |
|------|--------|
| `packages/design-system/1-tokens/src/font.ts` | Add `FontWeightToken`, `fontWeight` map, `LineHeightToken`, `lineHeight` map, `LetterSpacingToken`, `letterSpacing` map |
| `packages/design-system/1-tokens/src/shadow.ts` | New file — `ShadowToken`, `shadow` map |
| `packages/design-system/1-tokens/src/index.ts` | Re-export new types and values |
| `packages/design-system/types/src/index.ts` | Import `FontWeightToken`, `LineHeightToken`, `LetterSpacingToken`, `ShadowToken` from `@we/tokens`. Update `FontWeight` to compose with `FontWeightToken`. Update `DesignSystemProps` property types. Remove resolved TODO lines. |
| `packages/design-system/3-primitives/src/shared/helpers.ts` | Update font-weight, line-height, letter-spacing, shadow setters to use `tokenVar()` |
| `packages/design-system/1-tokens/src/css-gen.ts` (if exists) | Generate `--we-font-weight-*`, `--we-line-height-*`, `--we-letter-spacing-*`, `--we-shadow-*` CSS custom properties |

## Risk

**Low.** All changes are additive type widening — existing string values continue to work. The helpers pipeline already handles raw passthrough, so tokenized lookups are a strict superset.

Only risk is if consumers pass raw CSS values (e.g. `lineHeight="1.75"`) that don't match the new token type — those would get a TypeScript error. Mitigation: use `LineHeightToken | (string & {})` pattern if needed for escape hatch, or add the value to the scale.

## Size

**Small–Medium.** Mostly type definitions and value maps. The helpers pipeline changes are mechanical (swap raw set for tokenVar lookup).
