/**
 * FONT TOKEN DEFINITIONS
 * This file defines typography tokens that serve as the source of truth for the design system.
 */

// TODO: add font weight?

// Literal union types for font tokens
export type FontFamilyToken = 'base';
export type FontSizeToken = 'base' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | '1000';

/**
 * Font family definitions.
 * These values define the typefaces used in the system.
 */
export const fontFamily = {
  base: "'DM Sans', sans-serif",
} satisfies Record<FontFamilyToken, string>;

/**
 * Font size scale.
 * Defines the range of text sizes available in the system.
 * The scale follows a typographic modular scale with appropriate values for various contexts.
 */
export const fontSize = {
  base: '16px', // Base size reference
  '100': '0.56rem', // ~9px
  '200': '0.63rem', // ~10px
  '300': '0.75rem', // ~12px
  '400': '0.88rem', // ~14px
  '500': '1rem', // 16px
  '600': '1.25rem', // ~20px
  '700': '1.5rem', // ~24px
  '800': '2rem', // ~32px
  '900': '2.63rem', // ~42px
  '1000': '3.63rem', // ~58px
} satisfies Record<FontSizeToken, string>;

/**
 * Complete font token object that combines all typography categories.
 * This is the main export for consumers who need typography tokens.
 */
export const font = {
  family: fontFamily,
  size: fontSize,
};
