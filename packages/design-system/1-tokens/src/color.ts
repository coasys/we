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
export type ColorConfigToken = 'polarity' | 'lightnessFloor' | 'lightnessCeiling' | 'saturation' | 'neutralSaturation';
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
  polarity: 'light',
  lightnessFloor: '0%',
  lightnessCeiling: '100%',
  saturation: 60,
  neutralSaturation: 10,
} satisfies Record<ColorConfigToken, number | Percentage | Polarity>;

export type Polarity = 'light' | 'dark';

/**
 * Polarity, as the two numbers the ramp formula multiplies by.
 *
 * `offset`/`direction` are an implementation detail of "which end does the scale count from" —
 * light counts up from the floor, dark counts down from the ceiling. They exist because CSS has to
 * evaluate the ramp as arithmetic, and they are deliberately not part of what a theme states.
 */
export const RAMP = {
  light: { offset: 0, direction: 1 },
  dark: { offset: 1, direction: -1 },
} satisfies Record<Polarity, { offset: number; direction: number }>;

/**
 * How far a fill's hover and pressed states move, and which way.
 *
 * Published as variables rather than written into the roles as literals, because which way a state
 * should move is a property of the theme and `oklch(from …)` cannot branch on one.
 *
 * ## These are magnitudes; the sign is decided at apply time
 *
 * The rule is *away from the label*: a state that widens the gap between a fill and the text on it
 * gains contrast, and one that closes it loses contrast exactly while the control is being pressed.
 * Under the old scale-position scheme that held by accident — a fill and its label sat at opposite
 * ends of the ramp, so "one step further along" was always away — which is why the old dark theme's
 * hover lightened and the old light theme's darkened, and both were right.
 *
 * Polarity is a proxy for that rule and it fails in both directions. Assume dark themes lighten and
 * a dark theme with a mid accent, which the derivation gives a near-*white* label, walks its hover
 * into that label — `dark` measured Lc 29 and `black` Lc 33 doing this. Assume everything deepens
 * and a theme that *pins* a near-black label deepens toward it instead: the same mistake mirrored,
 * and what turned the `dark` preset's selected nav tab the wrong way.
 *
 * So the numbers below are the *distance* a state travels, and `applyStateDirection` in @we/themes
 * decides the sign per fill family once the label is known. Both entries are therefore identical
 * and the polarity key is kept only so a theme can still ask for different magnitudes light and
 * dark. Only `Math.abs` of these is read.
 */
/**
 * Where each fill lives — an absolute lightness per family, not a step on the neutral ramp.
 *
 * ## Why a fill leaves the ramp entirely
 *
 * The surface stack is defined *relative to the page* and so must invert with the theme. A fill is
 * not: a red is red in a light theme and in a dark one. Step 500 is the ramp's polarity fixed point
 * (L 60.0 light, L 60.4 dark, where 700 swings 36.6 points), so it looked like the answer — but it
 * is one lightness for every hue, and that is the thing OKLCH makes impossible to ignore.
 *
 * **Hues are not equally light.** Violet at L 0.60 is a strong colour; yellow at L 0.60 is olive.
 * The old HSL ramp hid this by calling both "50% lightness" while rendering them 20 perceptual
 * points apart — which is the defect that motivated the move to OKLCH, and also, accidentally, the
 * reason the old palette's amber looked like amber. Putting every fill at one lightness fixes the
 * measurement and breaks the colours.
 *
 * So each family sits where its hue is actually itself. These are the lightnesses the pre-OKLCH
 * palette rendered, measured off it rather than chosen: violet is a dark colour and gold is a light
 * one, and both were already true before anybody wrote it down.
 *
 * Absolute, so they do not move with polarity — which is what makes a brand colour a brand colour.
 * `saturation` still scales their chroma, so a theme turning itself down turns its fills down too.
 */
export const FILL_LIGHTNESS = {
  primary: 0.55,
  danger: 0.62,
  success: 0.75,
  warning: 0.76,
} as const;

export const STATE_STEPS = {
  light: { hover: -0.05, active: -0.09 },
  dark: { hover: -0.05, active: -0.09 },
} satisfies Record<Polarity, { hover: number; active: number }>;

/**
 * Base hue values for semantic colors, as OKLCH hue angles (0-360).
 *
 * Not the same numbers as the HSL angles they replace, and not a rename: the two spaces disagree
 * about where a hue sits, by as much as 45 degrees in the warm end. Each value here is the OKLCH
 * hue of the sRGB colour the old HSL angle actually produced, so the palette keeps its identity —
 * 250 became 288 because that is where "that blue" lives in OKLCH, not because the blue changed.
 * Measured off the rendered accent rather than converted at a nominal mid-point: an HSL hue maps to
 * a small *range* of OKLCH hues depending on lightness and saturation, and the one that matters is
 * where the accent actually sits.
 * Stored themes are converted by `migrate.ts`; a hue somebody types is now an OKLCH angle.
 */
export const colorHues = {
  neutral: 288,
  primary: 288,
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

/**
 * The taper, taken at the lightness a step actually lands on — **after** the ramp, not before it.
 *
 * This took a step name and read the *raw* table entry, on a comment saying the taper "must not
 * follow the theme's inversion". The generated CSS has never agreed: it computes
 * `2 * max(0, min(L, 1 - L))` from `--we-color-lightness-<step>`, which is the post-ramp value, so
 * it follows the ramp exactly. Two models of the same number, and the browser only ever ran one.
 *
 * They agree in a theme whose ramp is the identity — floor 0, ceiling 100 — which is `light` and
 * `retro`, and is why this survived. In `dark` they diverge 2.3×: step 200 lands at L 0.357, giving
 * a taper of 0.713 where the raw step gives 0.310. Measured against Chrome, the post-ramp form is
 * exact and the raw one is 12 rgb units out on the blue channel.
 *
 * The CSS is authoritative because the CSS is what renders, so the signature changed to make the
 * mistake unspellable: it now takes a number, and a caller has to have resolved the lightness before
 * it can ask. Chroma barely moves either contrast metric — both are lightness-dominated — which is
 * why this never flipped a verdict, and is no reason for a suite that grades themes to be modelling
 * a colour the browser does not paint.
 */
export function chromaTaper(lightness: number): number {
  return Number((2 * Math.max(0, Math.min(lightness, 1 - lightness))).toFixed(4));
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
  const floor = parseFloat(colorConfig.lightnessFloor);
  const ceiling = parseFloat(colorConfig.lightnessCeiling);
  const { offset, direction } = RAMP[colorConfig.polarity];
  const t = (parseFloat(colorLightness[lightnessKey]) / 100 - offset) * direction;
  const adjustedLightness = floor + t * (ceiling - floor);
  // Tapered at where the step lands, matching the emitted CSS — see chromaTaper.
  const chroma = Math.min(saturation * CHROMA_PER_SATURATION, CHROMA_CEILING) * chromaTaper(adjustedLightness / 100);
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
