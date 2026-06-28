import type { ColorHueToken, ColorLightnessToken } from '@we/tokens';
import { color } from '@we/tokens';

import type { ThemeOverrides } from './types';

/**
 * Parametric keys that map 1:1 to a CSS custom property.
 * Keys that need special multi-var handling (shadowIntensity, animationSpeed) are excluded.
 */
type ParametricKey = Exclude<keyof ThemeOverrides, 'themeName' | 'shadowIntensity' | 'animationSpeed' | 'surfaceBlur' | 'fontScale'>;

/** Maps shadowIntensity preset to the CSS box-shadow value emitted as --we-theme-shadow. */
const SHADOW_INTENSITY_VALUES: Record<NonNullable<ThemeOverrides['shadowIntensity']>, string> = {
  flat: 'none',
  subtle: 'var(--we-shadow-sm)',
  elevated: 'var(--we-shadow-md)',
  dramatic: 'var(--we-shadow-xl)',
};

/** Maps animationSpeed preset to the --we-transition-N overrides applied globally. */
const ANIMATION_SPEED_VARS: Record<NonNullable<ThemeOverrides['animationSpeed']>, Record<string, string>> = {
  none: {
    '--we-transition-100': '0ms',
    '--we-transition-200': '0ms',
    '--we-transition-300': '0ms',
    '--we-transition-400': '0ms',
    '--we-transition-500': '0ms',
  },
  fast: {
    '--we-transition-200': '75ms',
    '--we-transition-300': '125ms',
    '--we-transition-400': '250ms',
    '--we-transition-500': '500ms',
  },
  normal: {},
  slow: {
    '--we-transition-100': '100ms',
    '--we-transition-200': '300ms',
    '--we-transition-300': '500ms',
    '--we-transition-400': '1000ms',
    '--we-transition-500': '2000ms',
  },
};

/** Map parametric ThemeOverrides keys to their CSS custom property equivalents. */
const THEME_CSS_MAP: Record<ParametricKey, string> = {
  // Color
  primaryHue: '--we-color-primary-hue',
  successHue: '--we-color-success-hue',
  warningHue: '--we-color-warning-hue',
  dangerHue: '--we-color-danger-hue',
  neutralHue: '--we-color-neutral-hue',
  saturation: '--we-color-saturation',
  neutralSaturation: '--we-color-neutral-saturation',
  multiplier: '--we-color-multiplier',
  subtractor: '--we-color-subtractor',
  ringColor: '--we-ring-color',
  // Typography
  fontFamily: '--we-font-family',
  letterSpacing: '--we-theme-letter-spacing',
  lineHeight: '--we-theme-line-height',
  // Shape
  controlRadius: '--we-theme-control-radius',
  surfaceRadius: '--we-theme-surface-radius',
  inputRadius: '--we-theme-input-radius',
  // Density
  controlPaddingX: '--we-theme-control-padding-x',
  controlGap: '--we-theme-control-gap',
  controlHeight: '--we-theme-control-height-offset',
  surfaceSpacing: '--we-theme-surface-spacing',
  surfaceGap: '--we-theme-surface-gap',
  // Effects
  surfaceOpacity: '--we-theme-surface-opacity',
};

/** Saturation variable used by each color family. */
const FAMILY_SAT_VAR: Record<ColorHueToken, string> = {
  primary: '--we-color-saturation',
  success: '--we-color-saturation',
  warning: '--we-color-saturation',
  danger: '--we-color-saturation',
  neutral: '--we-color-neutral-saturation',
};

const LIGHTNESS_STEPS = Object.keys(color.lightness) as ColorLightnessToken[];
const COLOR_FAMILIES = Object.keys(color.hues) as ColorHueToken[];

/**
 * Convert a ThemeOverrides object to a CSS style record for inline application.
 *
 * CSS custom properties are resolved at the element where they are DEFINED,
 * not where they are inherited.  :root defines derived tokens like
 *   --we-color-primary-500: hsl(var(--we-color-primary-hue) ...)
 * which are computed once using :root's values.  Children inherit the computed
 * color, so overriding --we-color-primary-hue on a descendant has no effect
 * unless we ALSO re-declare the derived token formulas on that descendant.
 *
 * When a named theme is used (themeName), the CSS theme file sets the input
 * variables via [data-we-theme] selectors. We unconditionally re-declare ALL
 * derived formulas so they resolve locally against whatever inputs the theme sets.
 */
export function themeToStyle(theme: ThemeOverrides): Record<string, string> {
  const style: Record<string, string> = {};
  const hasNamedTheme = !!theme.themeName;

  // 1. Set any explicit parametric overrides as custom properties
  for (const [key, cssVar] of Object.entries(THEME_CSS_MAP)) {
    const value = theme[key as ParametricKey];
    if (value !== undefined) style[cssVar] = String(value);
  }

  // shadowIntensity → --we-theme-shadow (used by Card and other surface components)
  if (theme.shadowIntensity) {
    style['--we-theme-shadow'] = SHADOW_INTENSITY_VALUES[theme.shadowIntensity];
  }

  // surfaceBlur → --we-theme-surface-blur (backdrop-filter blur for frosted glass)
  // Only emitted when > 0 to avoid triggering GPU compositing on the default state.
  if (theme.surfaceBlur && theme.surfaceBlur > 0) {
    style['--we-theme-surface-blur'] = `${theme.surfaceBlur}px`;
  }

  // animationSpeed → override --we-transition-N tokens consumed by all primitives
  if (theme.animationSpeed) {
    Object.assign(style, ANIMATION_SPEED_VARS[theme.animationSpeed]);
  }

  // 2. Re-declare neutral-hue linkage when primaryHue is explicitly overridden
  if (theme.primaryHue !== undefined && theme.neutralHue === undefined) {
    style['--we-color-neutral-hue'] = 'var(--we-color-primary-hue)';
  }

  // 3. Re-declare lightness scale
  // Named themes may change multiplier/subtractor via CSS, so always re-declare.
  const affectsLightness = hasNamedTheme || theme.multiplier !== undefined || theme.subtractor !== undefined;
  if (affectsLightness) {
    for (const step of LIGHTNESS_STEPS) {
      const base = parseFloat(color.lightness[step]);
      style[`--we-color-lightness-${step}`] =
        `calc((${base}% - var(--we-color-subtractor)) * var(--we-color-multiplier))`;
    }
  }

  // 4. Re-declare derived color tokens for affected families
  // Named themes: re-declare all families unconditionally (the CSS theme file
  // may change any input variable, and we can't know which without duplicating
  // the theme's values here).
  const affectsAllSatFamilies = hasNamedTheme || theme.saturation !== undefined || affectsLightness;
  for (const family of COLOR_FAMILIES) {
    const hueKey = family === 'neutral' ? 'neutralHue' : (`${family}Hue` as ParametricKey);
    const familyAffected =
      hasNamedTheme ||
      theme[hueKey] !== undefined ||
      (family === 'neutral'
        ? theme.primaryHue !== undefined || theme.neutralSaturation !== undefined || affectsLightness
        : affectsAllSatFamilies);
    if (!familyAffected) continue;

    const satVar = FAMILY_SAT_VAR[family];
    for (const step of LIGHTNESS_STEPS) {
      style[`--we-color-${family}-${step}`] =
        `hsl(var(--we-color-${family}-hue) var(${satVar}) var(--we-color-lightness-${step}))`;
    }
  }

  // 5. Re-declare gradient when primary hue or saturation may have changed
  const affectsPrimaryGradient =
    hasNamedTheme || theme.primaryHue !== undefined || theme.saturation !== undefined || affectsLightness;
  if (affectsPrimaryGradient) {
    style['--we-gradient-primary'] =
      'linear-gradient(135deg, hsl(calc(var(--we-color-primary-hue) - 30) var(--we-color-saturation) var(--we-color-lightness-500)) 0%, hsl(calc(var(--we-color-primary-hue) + 30) var(--we-color-saturation) var(--we-color-lightness-500)) 100%)';
  }

  // 6. Re-declare semantic tokens that alias --we-color-primary-500.
  // These are defined at :root as var() references, but an inline style baked by
  // populateMissingOverrides() or a named theme's CSS rule can pin them to a stale
  // resolved value. Re-declaring them here as formulas ensures they stay in sync
  // with any primary colour change on this element.
  if (affectsPrimaryGradient) {
    if (theme.ringColor === undefined) style['--we-ring-color'] = 'var(--we-color-primary-500)';
    style['--we-color-focus'] = 'var(--we-color-primary-500)';
    style['--we-focus-outline'] = '0 0 0 2px var(--we-color-focus)';
  }

  // fontScale: sets font-size on the root element, scaling all rem-based tokens
  if (theme.fontScale !== undefined) {
    style['font-size'] = `${theme.fontScale * 16}px`;
  }

  return style;
}
