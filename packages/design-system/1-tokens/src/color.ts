/**
 * COLOR TOKEN DEFINITIONS
 * This file defines color tokens that serve as the source of truth for the design system.
 */

// Base types
export type Percentage = `${string}%`;
export type HexColor = `#${string}`;

// Literal union types
export type ColorHueToken = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
export type ColorBaseToken = 'white' | 'black';
export type ColorConfigToken = 'multiplier' | 'subtractor' | 'saturation' | 'neutralSaturation';
export type ColorLightnessToken =
  | '0'
  | '25'
  | '50'
  | '75'
  | '100'
  | '200'
  | '300'
  | '400'
  | '500'
  | '600'
  | '700'
  | '800'
  | '900'
  | '1000';

// Unified color token type
export type ColorToken = ColorBaseToken | `${ColorHueToken}-${ColorLightnessToken}`;

// Branded type to allow both tokens and raw color values while preserving autocomplete
export type ColorValue = ColorToken | (string & {});

/**
 * Color system configuration values.
 * These control how colors are calculated and transformed for different themes.
 */
export const colorConfig = {
  multiplier: 1,
  subtractor: '0%',
  saturation: '60%',
  neutralSaturation: '10%',
} satisfies Record<ColorConfigToken, number | Percentage>;

/**
 * Base hue values for semantic colors.
 * Values represent positions on the color wheel (standard range is 0-360).
 */
export const colorHues = {
  neutral: 610,
  primary: 610,
  success: 130,
  warning: 45,
  danger: 350,
} satisfies Record<ColorHueToken, number>;

/**
 * Lightness scale from 0-1000.
 * Lower numbers are lighter colors (0 = white/100% lightness),
 * Higher numbers are darker colors (1000 = black/0% lightness).
 */
export const colorLightness = {
  '0': '100%',
  '25': '97.5%',
  '50': '95%',
  '75': '92.5%',
  '100': '90%',
  '200': '80%',
  '300': '70%',
  '400': '60%',
  '500': '50%',
  '600': '40%',
  '700': '30%',
  '800': '20%',
  '900': '10%',
  '1000': '0%',
} satisfies Record<ColorLightnessToken, Percentage>;

/**
 * Absolute color values that don't follow the HSL pattern.
 */
export const colorBase = {
  white: '#ffffff',
  black: '#000000',
} satisfies Record<ColorBaseToken, HexColor>;

/**
 * Helper function to calculate the HSL color string for a given hue, saturation, and lightness level
 */
function calculateColor(hue: number, saturation: string, lightnessKey: ColorLightnessToken): string {
  // Parse the lightness percentage
  const rawLightness = colorLightness[lightnessKey].replace('%', '');
  const lightnessNum = parseFloat(rawLightness);

  // Apply the subtractor and multiplier as in the SCSS function
  const subtractorValue = parseFloat(colorConfig.subtractor.replace('%', '') || '0');
  const multiplierValue = colorConfig.multiplier;
  const adjustedLightness = (lightnessNum - subtractorValue) * multiplierValue;

  // Return the HSL color string
  return `hsl(${hue}, ${saturation}, ${adjustedLightness}%)`;
}

/**
 * Helper function to generate a complete color scale for a given hue and saturation
 */
function generateColorScale(hue: number, saturation: string): Record<ColorLightnessToken, string> {
  return Object.keys(colorLightness).reduce(
    (acc, key) => {
      const lightnessKey = key as ColorLightnessToken;
      acc[lightnessKey] = calculateColor(hue, saturation, lightnessKey);
      return acc;
    },
    {} as Record<ColorLightnessToken, string>,
  );
}

// Generate concrete color scales using the hue and saturation values
export const colorNeutral = generateColorScale(colorHues.neutral, colorConfig.neutralSaturation);
export const colorPrimary = generateColorScale(colorHues.primary, colorConfig.saturation);
export const colorSuccess = generateColorScale(colorHues.success, colorConfig.saturation);
export const colorWarning = generateColorScale(colorHues.warning, colorConfig.saturation);
export const colorDanger = generateColorScale(colorHues.danger, colorConfig.saturation);

/**
 * Complete color token object that combines all color categories.
 * This is the main export for consumers who need the full color system.
 */
export const color = {
  config: colorConfig,
  hues: colorHues,
  lightness: colorLightness,
  base: colorBase,
  neutral: colorNeutral,
  primary: colorPrimary,
  success: colorSuccess,
  warning: colorWarning,
  danger: colorDanger,
};
