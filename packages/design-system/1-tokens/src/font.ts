/**
 * FONT TOKEN DEFINITIONS
 * This file defines typography tokens that serve as the source of truth for the design system.
 */

// Literal union types for font tokens
export type FontFamilyToken = 'base' | 'mozilla' | 'boldonse';
export type FontFamilyValue = FontFamilyToken | (string & {});
export type FontSizeToken = 'base' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | '1000';
export type FontSizeValue = FontSizeToken | (string & {});
export type FontWeightToken =
  | '100'
  | '200'
  | '300'
  | '400'
  | '500'
  | '600'
  | '700'
  | '800'
  | '900'
  | 'regular'
  | 'medium'
  | 'semibold'
  | 'bold';
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
  mozilla: "'Mozilla Text', serif",
  boldonse: "'Boldonse', serif",
} satisfies Record<FontFamilyToken, string>;

/**
 * Font size scale.
 * Defines the range of text sizes available in the system.
 * The scale follows a typographic modular scale with appropriate values for various contexts.
 */
export const fontSize = {
  base: '16px', // Base size reference
  '100': '0.75rem', // 12px — caption / footnote
  '200': '0.875rem', // 14px — label / secondary
  '300': '1rem', // 16px — body (browser default)
  '400': '1.125rem', // 18px — lead / subheading
  '500': '1.25rem', // 20px — heading-sm
  '600': '1.5rem', // 24px — heading-md
  '700': '2rem', // 32px — heading-lg
  '800': '2.5rem', // 40px — heading-xl
  '900': '3.5rem', // 56px — display
  '1000': '4.5rem', // 72px — hero
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
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
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
