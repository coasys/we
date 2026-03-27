import type { ColorHueToken, ColorLightnessToken } from '@we/tokens';
import { color } from '@we/tokens';

import type { ThemeOverrides } from './types';

/** Parametric keys (excludes themeName which is handled separately). */
type ParametricKey = Exclude<keyof ThemeOverrides, 'themeName'>;

/** Map parametric ThemeOverrides keys to their CSS custom property equivalents. */
const THEME_CSS_MAP: Record<ParametricKey, string> = {
  primaryHue: '--we-color-primary-hue',
  successHue: '--we-color-success-hue',
  warningHue: '--we-color-warning-hue',
  dangerHue: '--we-color-danger-hue',
  uiHue: '--we-color-ui-hue',
  saturation: '--we-color-saturation',
  uiSaturation: '--we-color-ui-saturation',
  multiplier: '--we-color-multiplier',
  subtractor: '--we-color-subtractor',
  fontFamily: '--we-font-family',
};

/** Saturation variable used by each color family. */
const FAMILY_SAT_VAR: Record<ColorHueToken, string> = {
  primary: '--we-color-saturation',
  success: '--we-color-saturation',
  warning: '--we-color-saturation',
  danger: '--we-color-saturation',
  ui: '--we-color-ui-saturation',
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

  // 2. Re-declare ui-hue linkage when primaryHue is explicitly overridden
  if (theme.primaryHue !== undefined && theme.uiHue === undefined) {
    style['--we-color-ui-hue'] = 'var(--we-color-primary-hue)';
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
    const hueKey = family === 'ui' ? 'uiHue' : (`${family}Hue` as ParametricKey);
    const familyAffected =
      hasNamedTheme ||
      theme[hueKey] !== undefined ||
      (family === 'ui'
        ? theme.primaryHue !== undefined || theme.uiSaturation !== undefined || affectsLightness
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

  return style;
}
