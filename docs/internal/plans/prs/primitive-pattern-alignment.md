# Plan: Align Primitive Variant/Size Patterns with DS Pipeline

> Follow-up to button-variants (#1). Migrates primitives that bypass the design system pipeline to use `getDefaultProps()`/`getInstanceProps()` consistently.

---

## Problem

Four primitives have `variant` or `size` properties implemented via manual CSS `:host([attr])` selectors with component-specific CSS custom variables (e.g. `--we-badge-bg`). This bypasses the design system pipeline (`getDefaultProps` → `mergeProps` → `updateAllCustomVars`), which means:

- No `hoverProps`/`activeProps`/`focusProps` support for variant-specific states
- Explicit DS props can't override variant defaults (CSS specificity fights)
- Two mental models for the same concept across primitives
- New primitives (#10 Component Library Expansion) won't have a clear canonical pattern to follow

## Current state

| Component | Has variant/size? | Current pattern | Needs migration? |
|-----------|-------------------|-----------------|-------------------|
| **badge** | variant + size | Manual CSS vars (`--we-badge-*`) | **Yes** — migrate to DS pipeline |
| **icon** | size + weight | Manual CSS vars (`--icon-size`) | **No** — size maps to a single CSS dimension, weight is icon-specific. CSS approach is correct here. |
| **avatar** | size | Manual CSS vars (`--we-avatar-size-*`) | **No** — size maps to a single CSS dimension. Same reasoning as icon. |
| **spinner** | size | Manual CSS vars (`--we-spinner-*`) | **No** — size maps to a single CSS dimension. |
| **button** | variant + size (after #1) | DS pipeline | Already migrated in #1 |

### Why icon/avatar/spinner stay as-is

These components use `size` to set a **single CSS dimension** (width/height). Their size isn't a compound mapping to multiple DS props (padding, font-size, gap, etc.) — it's just a pixel value. The CSS `:host([size='sm'])` approach is perfectly fine for this because:
- No DS prop merging needed (it's one value)
- No state interaction (hover/active don't change size)
- No override concern (nobody writes `<we-icon size="sm" width="100px">`)

The DS pipeline is the right tool when variant/size maps to **multiple design system properties** (bg, color, padding, hoverProps, etc.). For single-dimension sizing, CSS is simpler and correct.

### Why badge needs migration

Badge's `variant` maps to `bg` + `color` — two DS properties. Its `size` maps to `font-size` + `padding` — also multiple DS properties. This is the same multi-property compound mapping that button has, so it should use the same DS pipeline approach.

Additionally, badge currently extends `LayoutVisualTypographyElement` and manually declares `@property bg`, `@property color`, `@property weight` which overlap with the DS mixin's own registered properties for those layers. This is the kind of duplication the pipeline eliminates.

**Important:** Badge should stay on `LayoutVisualTypographyElement` — the specialized base classes exist to scope which DS layers a component opts into, and badge doesn't need flex (`direction`, `ax`, `ay`, `wrap`) or state (`hoverProps`, `activeProps`). The variant/size `getInstanceProps()` pattern works with any base class.

## Implementation

### 1. Migrate badge to DS pipeline

**Current:** `extends LayoutVisualTypographyElement` + manual CSS vars
**Target:** `extends LayoutVisualTypographyElement` (unchanged) + `getInstanceProps()` override with variant/size maps

Variant maps `bg` + `color` (visual layer — already active):

```ts
const VARIANT_DEFAULTS: Record<string, Partial<DesignSystemProps>> = {
  primary: { bg: 'primary-100', color: 'primary-600' },
  success: { bg: 'success-100', color: 'success-600' },
  warning: { bg: 'warning-100', color: 'warning-600' },
  danger:  { bg: 'red-100', color: 'red-600' },
};
```

Size maps `fontSize` (typography layer — already active). Padding stays in CSS via `:host([size])` selectors because `px`/`py` are in the flex layer, which `LayoutVisualTypographyElement` doesn't include — and adding the flex layer just for padding would also register `direction`, `ax`, `ay`, `wrap`, `gap` which badge doesn't need.

```ts
const SIZE_DEFAULTS: Record<string, Partial<DesignSystemProps>> = {
  sm: { fontSize: '300' },
  lg: { fontSize: '500' },
};
```

```css
/* Padding stays in CSS — only two values per size, no DS prop interaction needed */
:host([size='sm']) { --we-badge-padding: var(--we-space-100) var(--we-space-200); }
:host([size='lg']) { --we-badge-padding: var(--we-space-300) var(--we-space-500); }
```

Follow the same `getInstanceProps()` override pattern established in button (#1). Remove manual `@property bg`, `@property color` declarations (now handled by the DS mixin's visual layer). Remove `:host([variant='...'])` CSS rules (now handled by `updateAllCustomVars`). Keep `:host([size='...'])` CSS for padding only.

### 2. Verify no regressions

Badge is used in `CollapsibleSidebar` (navigation item badges) and potentially in schema templates. Visual output should be identical — same colors, same sizes, just different implementation path.

## Files to change

| File | Change |
|------|--------|
| `3-primitives/src/primitives/badge.ts` | Migrate to DS pipeline pattern |
| `3-primitives/src/types.ts` | No change needed — `BadgeVariant` and `BadgeSize` types already exist |

## Sizing

Small — one component migration. The pattern is already established by button (#1). Mostly removing code (manual CSS vars, duplicate property declarations) and adding the variant/size default maps.

## Dependencies

- **Depends on:** Button Variants (#1) — establishes the pattern
- **Unblocks:** Component Library Expansion (#10) — new components with variants (Select, etc.) have a single canonical pattern to follow

## Risk

Low. Badge is simple. The visual output should be pixel-identical. Back-compat: `<we-badge variant="primary">` and `<we-badge size="sm">` keep working with the same API surface.
