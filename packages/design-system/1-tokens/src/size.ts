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
 */
export type RadiusToken = 'none' | 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'pill' | 'full';

// Branded type to allow both tokens and raw radius values (px, rem, %, etc.) while preserving autocomplete
export type RadiusValue = RadiusToken | (string & {});

export const radius = {
  none: '0',
  xxs: '0.125rem', // 2px
  xs: '0.25rem', // 4px
  sm: '0.375rem', // 6px
  md: '0.5rem', // 8px
  lg: '0.75rem', // 12px
  xl: '1rem', // 16px
  pill: '9999px',
  full: '50%',
} satisfies Record<RadiusToken, string>;

/**
 * Avatar size scale.
 */
export type AvatarSizeToken = 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';

export const avatarSize = {
  xxs: '1rem', // 16px
  xs: '1.5rem', // 24px
  sm: '2rem', // 32px
  md: '2.5rem', // 40px
  lg: '3rem', // 48px
  xl: '4rem', // 64px
  xxl: '5rem', // 80px
} satisfies Record<AvatarSizeToken, string>;
