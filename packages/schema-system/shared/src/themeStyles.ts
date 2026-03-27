import type { ColorHueToken, ColorLightnessToken } from '@we/tokens';
import { color } from '@we/tokens';

import type { ThemeOverrides } from './types';

/** Map ThemeOverrides keys to their CSS custom property equivalents. */
const THEME_CSS_MAP: Record<keyof ThemeOverrides, string> = {
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
 */
export function themeToStyle(theme: ThemeOverrides): Record<string, string> {
  const style: Record<string, string> = {};

  // 1. Set the input custom properties
  for (const [key, cssVar] of Object.entries(THEME_CSS_MAP)) {
    const value = theme[key as keyof ThemeOverrides];
    if (value !== undefined) style[cssVar] = String(value);
  }

  // 2. Re-declare ui-hue linkage: ui-hue inherits from primary-hue via CSS,
  //    but that var() reference is resolved at :root. When primaryHue is overridden
  //    on a descendant, we must re-declare the linkage so it resolves locally.
  if (theme.primaryHue !== undefined && theme.uiHue === undefined) {
    style['--we-color-ui-hue'] = 'var(--we-color-primary-hue)';
  }

  // 2. Re-declare lightness scale if multiplier/subtractor changed
  const affectsLightness = theme.multiplier !== undefined || theme.subtractor !== undefined;
  if (affectsLightness) {
    for (const step of LIGHTNESS_STEPS) {
      const base = parseFloat(color.lightness[step]);
      style[`--we-color-lightness-${step}`] =
        `calc((${base}% - var(--we-color-subtractor)) * var(--we-color-multiplier))`;
    }
  }

  // 3. Re-declare derived color tokens for affected families
  // Note: ui-hue inherits from primary-hue via CSS, so changing primaryHue also affects ui
  const affectsAllSatFamilies = theme.saturation !== undefined || affectsLightness;
  for (const family of COLOR_FAMILIES) {
    const hueKey = family === 'ui' ? 'uiHue' : (`${family}Hue` as keyof ThemeOverrides);
    const familyAffected =
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

  return style;
}
