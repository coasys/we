/**
 * The built-in themes, as parameters.
 *
 * A theme in WE is not a stylesheet — it is a handful of numbers. Colours are generated from a hue,
 * a saturation and a lightness ramp, and `multiplier`/`subtractor` transform that ramp:
 * `adjusted = (lightness - subtractor) * multiplier`. So `multiplier: -1` inverts the whole scale and
 * every token in the system goes dark at once, including tokens that did not exist when the theme was
 * written. That is what makes a theme something a community can author, share and install as data
 * rather than as two hundred hand-picked colours.
 *
 * ## Why these live here
 *
 * They lived in `@we/app-shell`, which meant the design system could not theme itself: importing
 * `@we/themes` and setting `data-we-theme="dark"` looked like it should work and did nothing, because
 * the CSS files carry only the few rules that *cannot* be parametric — a modal shadow, a tooltip
 * inversion — and everything else came from parameters the app applied. Any second host (a
 * playground, an embed, a future React shell) hit the same wall.
 *
 * The definitions belong to the design system. Persisting a choice, editing one, scoping one to a
 * space — those are host concerns and stay in the app.
 */

/**
 * The parametric inputs a theme sets.
 *
 * Deliberately only the fields the built-in presets use. The full vocabulary is `ThemeOverrides` in
 * `@we/schema-shared`, which a user-authored theme may use all of; these two describe the same thing
 * from two packages and should be consolidated — see the note in the audit.
 */
export interface ThemeParameters {
  /** `1` keeps the lightness ramp as authored, `-1` inverts it — the difference between light and dark. */
  multiplier?: number;
  /** Shifts the ramp before inverting. The percentages above 100 keep dark themes off pure black. */
  subtractor?: string;
  saturation?: string;
  neutralSaturation?: string;
  primaryHue?: number;
  successHue?: number;
  warningHue?: number;
  dangerHue?: number;
  neutralHue?: number;
}

export interface ThemePreset {
  name: string;
  /** Phosphor icon name, for a theme picker. */
  icon: string;
  parameters: ThemeParameters;
}

export const THEME_PRESETS = {
  light: {
    name: 'Light',
    icon: 'sun',
    parameters: { multiplier: 1, subtractor: '0%', saturation: '60%', neutralSaturation: '10%' },
  },
  dark: {
    name: 'Dark',
    icon: 'moon',
    // 108 rather than 100 so the darkest step lands short of pure black. A hand-tuned constant, and a
    // sign that a linear inversion is an approximation of a dark theme rather than a design of one.
    parameters: { multiplier: -1, subtractor: '108%', saturation: '50%', neutralSaturation: '20%' },
  },
  black: {
    name: 'Black',
    icon: 'square',
    parameters: { multiplier: -1, subtractor: '100%', saturation: '50%', neutralSaturation: '20%' },
  },
  retro: {
    name: 'Retro',
    icon: 'floppy-disk',
    parameters: { primaryHue: 230, multiplier: 1, subtractor: '0%', saturation: '60%', neutralSaturation: '10%' },
  },
  cyberpunk: {
    name: 'Cyberpunk',
    icon: 'cpu',
    parameters: { multiplier: -1, subtractor: '110%', saturation: '60%', neutralSaturation: '10%' },
  },
} as const satisfies Record<string, ThemePreset>;

export type ThemeName = keyof typeof THEME_PRESETS;

export const THEME_NAMES = Object.keys(THEME_PRESETS) as ThemeName[];

export function isThemeName(value: string): value is ThemeName {
  return value in THEME_PRESETS;
}
