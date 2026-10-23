/**
 * Every theme setting, and the variable it writes.
 *
 * ## Why one registry
 *
 * There were two maps from a setting to its variable: `THEME_CSS_MAP`, which wrote a theme, and a
 * copy in the app's theme store, which read one back to put the editor's sliders where the theme
 * left them. They had drifted — the copy read the lightness bounds back as `0.12` into a setting
 * that is written `'12%'` — and nothing said which was right. So a setting is described once: the
 * variable, how its value is written, and how it is read back. Writing, reading and the scoping test
 * all go through this.
 *
 * Settings that are not one value into one variable (a polarity expanding to the ramp's direction,
 * an animation speed rewriting five transition tokens, the font scale, the roles) are handled in
 * `themeStyles.ts` and named in `SPECIAL_SETTINGS`, so the compile-time check below can tell a
 * setting nobody handles from one handled elsewhere.
 *
 * The variables the *token CSS* works out from these on `:root` are listed in
 * `THEME_DERIVED_VARIABLES` (@we/tokens), which every theme re-declares wherever it is applied.
 */
import type { ThemeOverrides } from './overrides';

/** Settings that expand to more than one variable, or to none; handled in `themeStyles.ts`. */
export const SPECIAL_SETTINGS = [
  'schemaVersion',
  'themeName',
  'polarity',
  'shadowIntensity',
  'glowIntensity',
  'animationSpeed',
  'fontScale',
  'roles',
  'palette',
  'typeStyles',
  'components',
  'light',
  'dark',
] as const satisfies readonly (keyof ThemeOverrides)[];

type SpecialSetting = (typeof SPECIAL_SETTINGS)[number];
export type DirectSetting = Exclude<keyof ThemeOverrides, SpecialSetting>;

export interface ThemeSetting<K extends DirectSetting = DirectSetting> {
  /** The custom property the setting writes. */
  variable: string;
  /** How the setting's value is written; `undefined` writes nothing. Defaults to `String(value)`. */
  write?: (value: NonNullable<ThemeOverrides[K]>) => string | undefined;
  /**
   * How a value read back from computed style becomes the setting again, for the theme editor's
   * starting positions. Absent means the setting is not read back — see `fontFamily`.
   */
  read?: (raw: string) => ThemeOverrides[K] | undefined;
}

const asNumber = (raw: string): number | undefined => {
  const n = Number(raw);
  return raw !== '' && Number.isFinite(n) ? n : undefined;
};
const asString = (raw: string): string | undefined => raw || undefined;

/** A lightness bound is authored as a percentage and written unitless; see `themeStyles.ts`. */
const lightnessBound: ThemeSetting<'lightnessFloor' | 'lightnessCeiling'> = {
  variable: '',
  write: (value) => String(parseFloat(value) / 100),
  read: (raw) => {
    const n = asNumber(raw);
    return n === undefined ? undefined : `${Math.round(n * 1000) / 10}%`;
  },
};

export const THEME_SETTINGS: { [K in DirectSetting]: ThemeSetting<K> } = {
  // Colour
  accentHue: { variable: '--we-color-accent-hue', read: asNumber },
  successHue: { variable: '--we-color-success-hue', read: asNumber },
  warningHue: { variable: '--we-color-warning-hue', read: asNumber },
  dangerHue: { variable: '--we-color-danger-hue', read: asNumber },
  // Read through the accent's hue when unset; see `readThemeSettings`.
  neutralHue: { variable: '--we-color-neutral-hue', read: asNumber },
  saturation: { variable: '--we-color-saturation', read: asNumber },
  neutralSaturation: { variable: '--we-color-neutral-saturation', read: asNumber },
  accentSaturation: { variable: '--we-color-accent-saturation', read: asNumber },
  successSaturation: { variable: '--we-color-success-saturation', read: asNumber },
  warningSaturation: { variable: '--we-color-warning-saturation', read: asNumber },
  dangerSaturation: { variable: '--we-color-danger-saturation', read: asNumber },
  accentLightness: { variable: '--we-accent-lightness' },
  dangerLightness: { variable: '--we-danger-lightness' },
  successLightness: { variable: '--we-success-lightness' },
  warningLightness: { variable: '--we-warning-lightness' },
  lightnessFloor: { ...lightnessBound, variable: '--we-color-lightness-floor' },
  lightnessCeiling: { ...lightnessBound, variable: '--we-color-lightness-ceiling' },

  // Strokes and states
  borderWidth: { variable: '--we-theme-border-width' },
  focusRingWidth: { variable: '--we-theme-focus-ring-width' },
  stateDuration: { variable: '--we-theme-state-duration' },
  disabledOpacity: { variable: '--we-theme-disabled-opacity' },

  // Typography. The family is not read back: a base theme's own CSS may set it directly, and reading
  // it would store a font the person never chose.
  fontFamily: { variable: '--we-font-family' },
  headingFontFamily: { variable: '--we-theme-heading-font-family' },
  monoFontFamily: { variable: '--we-font-mono' },
  letterSpacing: { variable: '--we-theme-letter-spacing', read: asString },
  lineHeight: { variable: '--we-theme-line-height', read: asString },

  // Shape
  controlRadius: { variable: '--we-theme-control-radius', read: asString },
  surfaceRadius: { variable: '--we-theme-surface-radius', read: asString },
  inputRadius: { variable: '--we-theme-input-radius', read: asString },
  avatarRadius: { variable: '--we-theme-avatar-radius', read: asString },

  // Density
  spacingScale: { variable: '--we-theme-spacing-scale' },
  controlPaddingX: { variable: '--we-theme-control-padding-x', read: asString },
  controlGap: { variable: '--we-theme-control-gap', read: asString },
  controlHeightOffset: { variable: '--we-theme-control-height-offset', read: asString },
  surfacePadding: { variable: '--we-theme-surface-padding', read: asString },
  surfaceGap: { variable: '--we-theme-surface-gap', read: asString },
  inputPadding: { variable: '--we-theme-input-padding', read: asString },

  // Icons. Not read back: unset is a meaning (each icon's own weight), not a value to show.
  iconWeight: { variable: '--we-theme-icon-weight' },

  // Surfaces
  surfaceOpacity: { variable: '--we-theme-surface-opacity', read: asNumber },
  // Only written when above zero: a blur of nothing still promotes the element to its own layer.
  surfaceBlur: { variable: '--we-theme-surface-blur', write: (value) => (value > 0 ? `${value}px` : undefined) },
};

/** The variable each direct setting writes. */
export const THEME_SETTING_VARIABLES = Object.fromEntries(
  Object.entries(THEME_SETTINGS).map(([key, setting]) => [key, setting.variable]),
) as Record<DirectSetting, string>;

/** Write a theme's direct settings as variables. */
export function writeThemeSettings(theme: ThemeOverrides, into: Record<string, string>): void {
  for (const [key, setting] of Object.entries(THEME_SETTINGS) as [DirectSetting, ThemeSetting][]) {
    const value = theme[key];
    if (value === undefined) continue;
    const written = setting.write ? setting.write(value as never) : String(value);
    if (written !== undefined) into[setting.variable] = written;
  }
}

/**
 * Fill in the settings a theme leaves unset from what an element is actually showing, so the
 * editor's controls start where the theme put them rather than at hard-coded defaults.
 */
export function readThemeSettings(theme: ThemeOverrides, styles: CSSStyleDeclaration): ThemeOverrides {
  const result: Record<string, unknown> = { ...theme };
  for (const [key, setting] of Object.entries(THEME_SETTINGS) as [DirectSetting, ThemeSetting][]) {
    if (result[key] !== undefined || !setting.read) continue;
    let raw = styles.getPropertyValue(setting.variable).trim();
    // The neutral hue follows the accent's unless a theme separates them, and computed style hands
    // back the reference rather than the number. Only here: an unset radius must not become a hue.
    if (key === 'neutralHue' && (!raw || raw.startsWith('var('))) {
      raw = styles.getPropertyValue(THEME_SETTINGS.accentHue.variable).trim();
    }
    if (!raw || raw.startsWith('var(')) continue;
    const value = setting.read(raw);
    if (value !== undefined) result[key] = value;
  }
  return result as ThemeOverrides;
}
