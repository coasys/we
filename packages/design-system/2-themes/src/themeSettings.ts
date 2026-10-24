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
  'surfaceImages',
  'fontFaces',
  'typeStyles',
  'components',
  'light',
  'dark',
  'contrast',
] as const satisfies readonly (keyof ThemeOverrides)[];

type SpecialSetting = (typeof SPECIAL_SETTINGS)[number];

/** What each special setting does, for the reference — the bookkeeping ones say nothing. */
export const SPECIAL_SETTING_DOCS: Record<Exclude<SpecialSetting, 'schemaVersion' | 'themeName'>, string> = {
  polarity: '`light` or `dark`: which end of the ramp the scale starts from.',
  shadowIntensity: 'How strong shadows are, and which one a surface rests at: flat, subtle, elevated, dramatic.',
  glowIntensity: "How bright and wide `shadow: 'glow'` is: none, subtle, medium, strong.",
  animationSpeed: 'Every transition at once: none, fast, normal, slow.',
  fontScale: 'Multiplies the root font size, and with it every rem-based token.',
  roles: 'Pin one colour role to a value — see "Pinning a role". `\'\'` unpins a role the base preset pins.',
  palette:
    "The ten palette hues as a set: `saturation`, `lightness` (points lighter or deeper), and `hues.<hue>` to set one hue's own angle, lightness or saturation.",
  surfaceImages: 'A gradient laid over every surface of a kind, by surface role. Gradients only.',
  fontFaces: 'Typefaces the theme carries, as data: URLs, so a family it names can be one nobody has installed.',
  typeStyles: 'How each kind of text looks, by type role.',
  components: 'One component apart from its family, by its registered name, with the family keys.',
  light: 'What differs on the light side of a two-sided theme.',
  dark: 'What differs on the dark side.',
  contrast: '`contrast.more`: how the theme looks when somebody asks for more contrast.',
};
export type DirectSetting = Exclude<keyof ThemeOverrides, SpecialSetting>;

export interface ThemeSetting<K extends DirectSetting = DirectSetting> {
  /** The custom property the setting writes. */
  variable: string;
  /**
   * One line on what the setting does, for the generated reference (`reference.ts`). Required, so a
   * setting cannot be added without saying what it is for — the reference is built from this list.
   */
  doc: string;
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
const lightnessBound: Omit<ThemeSetting<'lightnessFloor' | 'lightnessCeiling'>, 'doc'> = {
  variable: '',
  write: (value) => String(parseFloat(value) / 100),
  read: (raw) => {
    const n = asNumber(raw);
    return n === undefined ? undefined : `${Math.round(n * 1000) / 10}%`;
  },
};

export const THEME_SETTINGS: { [K in DirectSetting]: ThemeSetting<K> } = {
  // Colour
  accentHue: {
    doc: "The accent family's hue, an OKLCH angle (blue is 263, not 220).",
    variable: '--we-color-accent-hue',
    read: asNumber,
  },
  successHue: { doc: "The success family's hue.", variable: '--we-color-success-hue', read: asNumber },
  warningHue: { doc: "The warning family's hue.", variable: '--we-color-warning-hue', read: asNumber },
  dangerHue: { doc: "The danger family's hue.", variable: '--we-color-danger-hue', read: asNumber },
  // Read through the accent's hue when unset; see `readThemeSettings`.
  neutralHue: {
    doc: "The greys' hue; follows the accent's when unset.",
    variable: '--we-color-neutral-hue',
    read: asNumber,
  },
  saturation: {
    doc: '0–100, a share of the chroma each hue can hold. The default every family starts from.',
    variable: '--we-color-saturation',
    read: asNumber,
  },
  neutralSaturation: {
    doc: '0–100, how tinted the greys are.',
    variable: '--we-color-neutral-saturation',
    read: asNumber,
  },
  accentSaturation: {
    doc: '0–100, the accent family alone.',
    variable: '--we-color-accent-saturation',
    read: asNumber,
  },
  successSaturation: {
    doc: '0–100, the success family alone.',
    variable: '--we-color-success-saturation',
    read: asNumber,
  },
  warningSaturation: {
    doc: '0–100, the warning family alone.',
    variable: '--we-color-warning-saturation',
    read: asNumber,
  },
  dangerSaturation: {
    doc: '0–100, the danger family alone.',
    variable: '--we-color-danger-saturation',
    read: asNumber,
  },
  accentLightness: {
    doc: '0–100, how light the accent fill is. The alternative to pinning the role.',
    variable: '--we-accent-lightness',
  },
  dangerLightness: { doc: '0–100, how light the danger fill is.', variable: '--we-danger-lightness' },
  successLightness: { doc: '0–100, how light the success fill is.', variable: '--we-success-lightness' },
  warningLightness: { doc: '0–100, how light the warning fill is.', variable: '--we-warning-lightness' },
  lightnessFloor: {
    ...lightnessBound,
    doc: 'The darkest lightness the theme uses, as a percentage.',
    variable: '--we-color-lightness-floor',
  },
  lightnessCeiling: {
    ...lightnessBound,
    doc: "The lightest, as a percentage. With the floor, the theme's contrast.",
    variable: '--we-color-lightness-ceiling',
  },

  // Strokes and states
  borderWidth: { doc: "Every border's width: hairline or heavy.", variable: '--we-theme-border-width' },
  focusRingWidth: { doc: "The focus ring's thickness.", variable: '--we-theme-focus-ring-width' },
  stateDuration: {
    doc: 'How long a hover, press or focus takes to arrive. Departures snap.',
    variable: '--we-theme-state-duration',
  },
  disabledOpacity: { doc: '0–1, how far a disabled control fades.', variable: '--we-theme-disabled-opacity' },

  // Typography. The family is not read back: a base theme's own CSS may set it directly, and reading
  // it would store a font the person never chose.
  fontFamily: { doc: 'The body face, as a font stack.', variable: '--we-font-family' },
  headingFontFamily: {
    doc: 'A display face for headings; the body face when unset. `typeStyles.heading.family` is the finer setting.',
    variable: '--we-theme-heading-font-family',
  },
  monoFontFamily: { doc: 'The face code is set in.', variable: '--we-font-mono' },
  letterSpacing: {
    doc: 'Tracking for all text; what a type role falls back to.',
    variable: '--we-theme-letter-spacing',
    read: asString,
  },
  lineHeight: {
    doc: 'Leading for all text; what a type role falls back to.',
    variable: '--we-theme-line-height',
    read: asString,
  },

  // Shape
  controlRadius: {
    doc: 'Buttons, badges, tags — anything pressed.',
    variable: '--we-theme-control-radius',
    read: asString,
  },
  surfaceRadius: {
    doc: 'Cards, modals, drawers, alerts, inset media.',
    variable: '--we-theme-surface-radius',
    read: asString,
  },
  inputRadius: { doc: 'Fields, selects, pickers.', variable: '--we-theme-input-radius', read: asString },
  avatarRadius: { doc: 'Avatars. `50%` (a circle) unless set.', variable: '--we-theme-avatar-radius', read: asString },

  // Density
  spacingScale: { doc: 'Multiplies the spacing tokens, apart from type.', variable: '--we-theme-spacing-scale' },
  controlPaddingX: { doc: "A control's horizontal padding.", variable: '--we-theme-control-padding-x', read: asString },
  controlGap: {
    doc: "The gap between a control's icon and its words.",
    variable: '--we-theme-control-gap',
    read: asString,
  },
  controlHeightOffset: {
    doc: 'Added to every fixed-height control: `4px` taller, `-4px` shorter.',
    variable: '--we-theme-control-height-offset',
    read: asString,
  },
  surfacePadding: {
    doc: "A card's, modal's or drawer's padding.",
    variable: '--we-theme-surface-padding',
    read: asString,
  },
  surfaceGap: { doc: "The gap between a surface's children.", variable: '--we-theme-surface-gap', read: asString },
  inputPadding: { doc: "A field's padding, as a shorthand.", variable: '--we-theme-input-padding', read: asString },

  // Icons. Not read back: unset is a meaning (each icon's own weight), not a value to show.
  iconWeight: {
    doc: 'The weight every icon is drawn in unless it names its own: thin, light, regular, bold, fill, duotone.',
    variable: '--we-theme-icon-weight',
  },

  // Surfaces
  surfaceOpacity: {
    doc: '0–1, how opaque surfaces are — below 1 for glass.',
    variable: '--we-theme-surface-opacity',
    read: asNumber,
  },
  // Only written when above zero: a blur of nothing still promotes the element to its own layer.
  surfaceBlur: {
    doc: 'Pixels of backdrop blur behind a translucent surface.',
    variable: '--we-theme-surface-blur',
    write: (value) => (value > 0 ? `${value}px` : undefined),
  },
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
