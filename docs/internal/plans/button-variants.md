# Plan: Button Variant System

## Problem
`we-button` currently has no `variant` prop. Styling is done via direct design token props (`bg`, `color`, etc.). Schema templates use `variant: 'primary'` / `variant: 'ghost'` but this only works loosely — the value passes through as an untyped attribute with no effect. In typed SolidJS components, it causes a type error.

This means every button usage must manually specify `bg`, `color`, and `hoverProps` combinations, leading to repetition and inconsistency.

## Proposed Variants

| Variant | Appearance | Use case |
|---------|-----------|----------|
| `primary` | Filled, brand color bg, white text | Main CTA |
| `secondary` | Subtle bg (ui-100), dark text | Secondary actions |
| `ghost` | Transparent bg, dark text, hover bg | Tertiary/inline actions |
| `danger` | Red bg, white text | Destructive actions |
| `outline` | Transparent bg, border, dark text | Alternative to ghost |

Each variant defines: `bg`, `color`, `hoverProps`, `activeProps`, `disabledProps`.

## Implementation

### 1. Add `variant` property to button primitive
**File:** `packages/design-system/3-primitives/src/primitives/button.ts`

```ts
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';

const VARIANT_DEFAULTS: Record<ButtonVariant, Partial<DesignSystemProps>> = {
  primary: {
    bg: 'primary-500',
    color: 'ui-0',
    hoverProps: { bg: 'primary-600', color: 'ui-0' },
  },
  secondary: {
    bg: 'ui-100',
    color: 'ui-800',
    hoverProps: { bg: 'ui-200', color: 'ui-900' },
  },
  ghost: {
    bg: 'transparent',
    color: 'ui-700',
    hoverProps: { bg: 'ui-100', color: 'ui-900' },
  },
  danger: {
    bg: 'red-500',
    color: 'ui-0',
    hoverProps: { bg: 'red-600', color: 'ui-0' },
  },
  outline: {
    bg: 'transparent',
    color: 'ui-700',
    border: '1px solid ui-300',
    hoverProps: { bg: 'ui-50', color: 'ui-900' },
  },
};

@property({ type: String }) variant?: ButtonVariant;
```

### 2. Apply variant defaults in the design system pipeline
The variant needs to set default prop values that can still be overridden by explicit props. Two approaches:

**Option A: Override `getDefaultProps()` dynamically**
Make `getDefaultProps()` instance-aware (currently static). When `variant` is set, merge variant defaults under the existing defaults, so explicit props still win.

**Option B: Apply in `updated()` lifecycle**
In the `updated()` method, if `variant` is set and the user hasn't explicitly provided a prop (e.g. `bg`), apply the variant's value. This requires tracking which props were explicitly set vs defaulted.

**Recommendation:** Option A is cleaner. Modify `getDefaultProps()` to accept the current `variant` and merge. The design system mixin already uses defaults — variant just changes which defaults apply.

### 3. Regenerate type declarations
After adding the `variant` property, the CEM (Custom Elements Manifest) analysis picks it up, and the type generation script (`generate-framework-declarations.ts`) will include `variant` in the JSX type definitions for Solid, React, and global.

```bash
pnpm --filter @we/primitives build
```

### 4. Update existing usages
Replace manual `bg`/`color` combinations in schema templates and components with `variant`:
- `weNativeApp.ts` — buttons using `variant: 'primary'` / `variant: 'ghost'` already pass the string; they'll now work
- `CreateSpacePage.tsx` — replace `bg="primary-500" color="ui-0"` with `variant="primary"`
- Other schema templates (DefaultTemplate, TestTemplate, TwitterTemplate)

## Variant vs explicit props precedence
Explicit props should always override variant defaults. If a user writes:
```html
<we-button variant="primary" bg="green-500">
```
The `bg` should be `green-500`, not `primary-500`. The variant just provides convenient defaults.

## Files to change

| File | Change |
|------|--------|
| `packages/design-system/3-primitives/src/primitives/button.ts` | Add `variant` + `size` properties, default maps for both |
| `packages/design-system/3-primitives/src/shared/design-system-mixin.ts` (or similar) | Support instance-level default overrides from variant/size |
| Type declarations (auto-generated) | Rebuilt after property addition |
| Schema templates + components | Replace manual bg/color/px/py with variant/size where appropriate |

---

## Size Variants

`we-button` also has no `size` prop. Padding, font size, icon size, and height are currently set via raw design tokens on every usage. A `size` property would standardise these.

### Proposed Sizes

| Size | Padding | Font size | Height | Use case |
|------|---------|-----------|--------|----------|
| `xs` | `px: '200', py: '100'` | `200` | ~24px | Inline/compact UI |
| `sm` | `px: '300', py: '100'` | `300` | ~28px | Secondary actions, toolbars |
| `md` | `px: '400', py: '200'` | `400` | ~36px | Default (current) |
| `lg` | `px: '500', py: '300'` | `500` | ~44px | Primary CTAs, hero sections |

### Implementation

```ts
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZE_DEFAULTS: Record<ButtonSize, Partial<DesignSystemProps>> = {
  xs: { px: '200', py: '100', fontSize: '200' },
  sm: { px: '300', py: '100', fontSize: '300' },
  md: { px: '400', py: '200', fontSize: '400' },
  lg: { px: '500', py: '300', fontSize: '500' },
};

@property({ type: String }) size?: ButtonSize;
```

Size defaults merge with variant defaults and explicit props. Precedence: **explicit props > variant > size > component defaults**.

### Interaction with variant
Size and variant are orthogonal — any combination should work:
```html
<we-button variant="primary" size="sm">Small Primary</we-button>
<we-button variant="ghost" size="lg">Large Ghost</we-button>
```

---

## Open questions
- Should other primitives (`we-input`, `we-badge`) follow the same variant/size pattern?
- Should variants and sizes be defined at the theme level (so different themes can remap styles)?
- Should `size` also affect icon size and gap within the button?
