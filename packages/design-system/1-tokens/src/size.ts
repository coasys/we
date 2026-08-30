/**
 * SIZE TOKEN DEFINITIONS
 * This file defines size tokens that serve as the source of truth for the design system.
 *
 * - `size`: General component sizing (e.g., width, height)
 * - `radius`: Border radius sizing
 * - `avatarSize`: Avatar component sizing
 */

/** Universal component size scale used by all component size props */
export type ComponentSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

// Extended dimensional scale — includes extremes for raw CSS sizing
export type SizeToken = 'xxs' | ComponentSize | 'xxl';

// Branded type to allow both tokens and raw size values (px, rem, %, etc.) while preserving autocomplete
export type SizeValue = SizeToken | (string & {});

/**
 * General component size scale (e.g., width, height, icon size).
 */
export const size = {
  xxs: '0.75rem', // 12px
  xs: '1rem', // 16px
  sm: '1.5rem', // 24px
  md: '2rem', // 32px
  lg: '2.5rem', // 40px
  xl: '3rem', // 48px
  xxl: '4rem', // 64px
} satisfies Record<SizeToken, string>;

/**
 * Border radius size scale.
 *
 * Uses a numeric scale (like spacing) for dimensional values,
 * with named tokens reserved for special non-linear values.
 */
export type RadiusToken = '0' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | 'pill' | 'full';

/**
 * Radius values that name a *role* rather than a size — they resolve to the theme's group
 * variable, so the element follows whatever the theme decided for things of its kind.
 *
 * They exist for the layer-4 components, which have no COMPONENT_CASCADE entry to inherit a group
 * from and so must be told at the call site. `EditableImage` is the reason: one component used
 * both for square profile pictures and for wide cover images, where the caller is the only thing
 * that knows which it is. Kept out of the `radius` scale itself — a scale position is a length,
 * these are indirections — and out of the theme editor's shared radius list, since `avatar`
 * resolves to a percentage and is only safe on a box guaranteed square.
 *
 * `media` and `surface` both read the theme's surface group and differ only in what they fall back
 * to when a theme sets nothing, which is the whole distinction: a *full-bleed* banner is square
 * until a theme rounds it, and a box *inset inside* a sheet takes the sheet's own rounding, because
 * square corners sitting inside a rounded container read as a mistake rather than as a choice.
 * `Card` had been spelling the second one out as a raw `var()` string since before there was a name
 * for it, which is how `r: 'surface'` came to look like it should already work.
 */
export type SemanticRadius = 'avatar' | 'media' | 'surface';

// Branded type to allow both tokens and raw radius values (px, rem, %, etc.) while preserving autocomplete
export type RadiusValue = RadiusToken | SemanticRadius | (string & {});

export const radius = {
  '0': '0', // 0px
  '100': '0.125rem', // 2px
  '200': '0.25rem', // 4px
  '300': '0.375rem', // 6px
  '400': '0.5rem', // 8px
  '500': '0.75rem', // 12px
  '600': '1rem', // 16px
  '700': '1.25rem', // 20px
  '800': '1.5rem', // 24px
  '900': '2rem', // 32px
  pill: '9999px',
  full: '50%',
} satisfies Record<RadiusToken, string>;

export const avatarSize = {
  xxs: '1rem', // 16px
  xs: '1.5rem', // 24px
  sm: '2rem', // 32px
  md: '2.5rem', // 40px
  lg: '3rem', // 48px
  xl: '4rem', // 64px
  xxl: '5rem', // 80px
} satisfies Record<SizeToken, string>;

/**
 * Component height scale.
 * Used for buttons, inputs, selects, badges, and other sized components
 * to ensure consistent heights across the design system.
 */
export const componentHeight = {
  xs: '1.5rem', // 24px
  sm: '2rem', // 32px
  md: '2.5rem', // 40px
  lg: '3rem', // 48px
  xl: '3.5rem', // 56px
} satisfies Record<ComponentSize, string>;
