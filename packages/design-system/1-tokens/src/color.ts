/**
 * COLOR TOKEN DEFINITIONS
 * This file defines color tokens that serve as the source of truth for the design system.
 */

// Base types
export type Percentage = `${string}%`;
export type HexColor = `#${string}`;

// Literal union types
export type ColorHueToken = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

/** Semantic variant scale used by component variant props — maps 1:1 to color hues */
export type ComponentVariant = ColorHueToken;
export type ColorBaseToken = 'white' | 'black';
export type ColorConfigToken = 'multiplier' | 'subtractor' | 'saturation' | 'neutralSaturation';
export type ColorLightnessToken =
  '0' | '25' | '50' | '75' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | '1000';

// Unified color token type
export type ColorToken = ColorBaseToken | `${ColorHueToken}-${ColorLightnessToken}`;

// Branded type to allow both tokens and raw color values while preserving autocomplete
export type ColorValue = ColorToken | (string & {});

/**
 * Color system configuration values.
 * These control how colors are calculated and transformed for different themes.
 */
/**
 * Saturation is a plain 0–100 number rather than a percentage string.
 *
 * OKLCH takes an absolute *chroma*, not a relative saturation, and CSS `calc()` cannot turn a
 * percentage into the number a chroma has to be — percentages only divide by other percentages, and
 * not into unitless. Keeping the 0–100 range means the editor's slider is unchanged and only the
 * type moves; `migrate.ts` converts stored themes.
 */
export const colorConfig = {
  multiplier: 1,
  subtractor: '0%',
  saturation: 60,
  neutralSaturation: 10,
} satisfies Record<ColorConfigToken, number | Percentage>;

/**
 * Base hue values for semantic colors, as OKLCH hue angles (0-360).
 *
 * Not the same numbers as the HSL angles they replace, and not a rename: the two spaces disagree
 * about where a hue sits, by as much as 45 degrees in the warm end. Each value here is the OKLCH
 * hue of the sRGB colour the old HSL angle actually produced, so the palette keeps its identity —
 * 250 became 281 because that is where "that blue" lives in OKLCH, not because the blue changed.
 * Stored themes are converted by `migrate.ts`; a hue somebody types is now an OKLCH angle.
 */
export const colorHues = {
  neutral: 281,
  primary: 281,
  success: 145,
  warning: 90,
  danger: 17,
} satisfies Record<ColorHueToken, number>;

/**
 * Lightness scale from 0-1000, in OKLCH lightness.
 *
 * Lower numbers are lighter (0 = white, 1000 = black). The values are *perceptual* lightness, which
 * is the whole reason the ramp is in OKLCH and not HSL: HSL lightness is a coordinate, so the same
 * "500" landed at L* 46 for blue and L* 69 for green — a 39-point swing across the hue slider, at
 * one nominal step. Every theme that changed a hue was silently changing how heavy its accent read,
 * and the three status *text* roles had to sit at three different steps (-600, -700, -800) purely to
 * compensate. Here one step means one lightness at every hue, so those collapse.
 *
 * The numbers are not round because they are anchored to what the neutral ramp already looked like:
 * each is the OKLCH lightness of the sRGB colour the old HSL step produced. That keeps greys, text
 * and surfaces exactly where they were and moves only the chromatic families — which is the point,
 * since those were the ones out of step.
 */
export const colorLightness = {
  '0': '100%',
  '25': '98%',
  '50': '96%',
  '75': '94.5%',
  '100': '92.5%',
  '200': '84.5%',
  '300': '76.5%',
  '400': '68.5%',
  '500': '60%',
  '600': '51%',
  '700': '42%',
  '800': '32%',
  '900': '21.5%',
  '1000': '0%',
} satisfies Record<ColorLightnessToken, Percentage>;

/**
 * How much chroma a step may carry, as a multiple of the theme's saturation.
 *
 * Chroma has to taper toward both ends or the pale steps land far outside sRGB and clip to
 * something garish — HSL did this implicitly (`saturation × min(l, 1−l)`) and OKLCH does not, since
 * chroma is absolute. `2 × min(L, 1−L)` reproduces that curve, and it is baked per step rather than
 * computed in CSS because it must not follow the theme's inversion: the taper is a property of
 * where the step sits on the ramp, and `min(L, 1−L)` is unchanged when the ramp flips.
 *
 * The 0.0035 constant is calibrated, not chosen: at saturation 50 it puts step 500 at chroma 0.140,
 * where the old HSL ramp measured 0.141, and the neutral at saturation 20 within 0.001. So a theme
 * keeps the saturation numbers it had.
 */
export const CHROMA_PER_SATURATION = 0.0035;

/**
 * The most chroma any step may ask for, before the taper.
 *
 * sRGB runs out of colour long before OKLCH does, and past the boundary the browser gamut-maps —
 * which does not fail quietly. `channels` carries `saturation: 85`, a perfectly ordinary number
 * under HSL where saturation is relative; multiplied out it asked for chroma 0.30, and a blue at
 * 0.30 maps to something on the magenta edge of the gamut. The whole accent turned pink.
 *
 * 0.18 sits inside sRGB for every hue at mid lightness (yellow, the tightest, tops out near 0.13
 * and simply saturates there). Capping rather than rescaling keeps saturation meaning the same
 * thing at the low end, where nothing is clipping and a theme's numbers should be honoured exactly.
 */
export const CHROMA_CEILING = 0.18;

export function chromaTaper(lightnessKey: ColorLightnessToken): number {
  const l = parseFloat(colorLightness[lightnessKey]) / 100;
  return Number((2 * Math.min(l, 1 - l)).toFixed(4));
}

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
function calculateColor(hue: number, saturation: number, lightnessKey: ColorLightnessToken): string {
  const lightnessNum = parseFloat(colorLightness[lightnessKey]);
  const subtractorValue = parseFloat(colorConfig.subtractor.replace('%', '') || '0');
  const adjustedLightness = (lightnessNum - subtractorValue) * colorConfig.multiplier;
  const chroma = Math.min(saturation * CHROMA_PER_SATURATION, CHROMA_CEILING) * chromaTaper(lightnessKey);
  return `oklch(${adjustedLightness}% ${chroma.toFixed(4)} ${hue})`;
}

/**
 * Helper function to generate a complete color scale for a given hue and saturation
 */
function generateColorScale(hue: number, saturation: number): Record<ColorLightnessToken, string> {
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
