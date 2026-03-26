/**
 * FONT TOKEN DEFINITIONS
 * This file defines typography tokens that serve as the source of truth for the design system.
 */

// Literal union types for font tokens
export type FontFamilyToken = 'base';
export type FontSizeToken = 'base' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | '1000';
export type FontSizeValue = FontSizeToken | (string & {});
export type FontWeightToken = '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';
export type LineHeightToken = 'none' | 'tight' | 'snug' | 'normal' | 'relaxed' | 'loose';
export type LineHeightValue = LineHeightToken | (string & {});
export type LetterSpacingToken = 'tighter' | 'tight' | 'normal' | 'wide' | 'wider' | 'widest';
export type LetterSpacingValue = LetterSpacingToken | (string & {});

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
 * Font weight scale.
 * Maps numeric weight tokens to CSS font-weight values.
 */
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

/**
 * Line height scale.
 * Named presets for common line-height values.
 */
export const lineHeight = {
  none: '1',
  tight: '1.25',
  snug: '1.375',
  normal: '1.5',
  relaxed: '1.625',
  loose: '2',
} satisfies Record<LineHeightToken, string>;

/**
 * Letter spacing scale.
 * Named presets for common letter-spacing values.
 */
export const letterSpacing = {
  tighter: '-0.05em',
  tight: '-0.025em',
  normal: '0',
  wide: '0.025em',
  wider: '0.05em',
  widest: '0.1em',
} satisfies Record<LetterSpacingToken, string>;

/**
 * Complete font token object that combines all typography categories.
 * This is the main export for consumers who need typography tokens.
 */
export const font = {
  family: fontFamily,
  size: fontSize,
  weight: fontWeight,
  lineHeight,
  letterSpacing,
};
