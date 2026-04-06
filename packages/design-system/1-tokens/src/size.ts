/**
 * SIZE TOKEN DEFINITIONS
 * This file defines size tokens that serve as the source of truth for the design system.
 *
 * - `size`: General component sizing (e.g., width, height)
 * - `radius`: Border radius sizing
 * - `avatarSize`: Avatar component sizing
 */

// Literal union type for named sizes
export type SizeToken = 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';

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

// Branded type to allow both tokens and raw radius values (px, rem, %, etc.) while preserving autocomplete
export type RadiusValue = RadiusToken | (string & {});

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

/**
 * Avatar size scale.
 */
export type AvatarSizeToken = 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';

// Branded type to allow both tokens and raw avatar size values (px, rem, %, etc.) while preserving autocomplete
export type AvatarSizeValue = AvatarSizeToken | (string & {});

export const avatarSize = {
  xxs: '1rem', // 16px
  xs: '1.5rem', // 24px
  sm: '2rem', // 32px
  md: '2.5rem', // 40px
  lg: '3rem', // 48px
  xl: '4rem', // 64px
  xxl: '5rem', // 80px
} satisfies Record<AvatarSizeToken, string>;
