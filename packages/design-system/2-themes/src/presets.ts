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

import type { ThemeOverrides } from './overrides';

/**
 * @deprecated One vocabulary, one declaration: `ThemeParameters` was the deliberately-narrow subset
 * the built-in presets used, while `ThemeOverrides` (then in `@we/schema-shared`) was the full
 * vocabulary — two declarations of the same thing, drifting apart. `ThemeOverrides` now lives here
 * and is the single type; this alias remains for compatibility.
 */
export type ThemeParameters = ThemeOverrides;

export interface ThemePreset {
  name: string;
  /** Phosphor icon name, for a theme picker. */
  icon: string;
  parameters: ThemeOverrides;
}

/**
 * A role pinned to one lightness, with the theme's own hue and saturation left variable.
 *
 * Pinning a role to a literal hex would freeze the whole colour, so changing `neutralHue` would move
 * every surface *except* the pinned ones and the theme would come apart. This fixes only the number
 * that is actually the design decision.
 */
const neutral = (lightness: number) =>
  `hsl(var(--we-color-neutral-hue) var(--we-color-neutral-saturation) ${lightness}%)`;

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
    // The role override is the first step past that approximation: in dark, a raised surface gets
    // *lighter* instead of casting a shadow — a relationship the uniform inversion cannot express.
    parameters: {
      multiplier: -1,
      subtractor: '108%',
      saturation: '50%',
      neutralSaturation: '20%',
      roles: {
        /*
          The surface stack, pinned rather than inherited.

          Left to the scale it comes out upside down: `page` is neutral-50 and `surface` is
          neutral-0, and the inversion flips their order, so a card lands *darker* than the page it
          sits on and a "sunken" well lands lighter than both. Every dark interface does the
          opposite — depth is carried by light, because there is no darker left to go.

          Four pinned lightnesses are all it takes, and they are what `contrast.test.ts` checks the
          ordering of. The alternative — deriving them — needs a step that stays perceptually even
          across the inversion, which the scale does not give and this file is not the place to
          invent.
        */
        page: neutral(10),
        surface: neutral(14),
        surfaceSunken: neutral(8),
        surfaceRaised: neutral(19),
        // White on this accent measures 3.6:1; the dark end measures 4.7. See contrast.test.ts.
        onAccent: neutral(10),
      },
    },
  },
  black: {
    name: 'Black',
    icon: 'square',
    parameters: {
      multiplier: -1,
      subtractor: '100%',
      saturation: '50%',
      neutralSaturation: '20%',
      // The page stays pure black — that is the theme — so the stack is built upwards from it
      // rather than around it. See the note on `dark` for why it has to be pinned at all.
      roles: { page: neutral(0), surface: neutral(5), surfaceSunken: neutral(2), surfaceRaised: neutral(10) },
    },
  },
  retro: {
    name: 'Retro',
    icon: 'floppy-disk',
    parameters: { primaryHue: 230, multiplier: 1, subtractor: '0%', saturation: '60%', neutralSaturation: '10%' },
  },
  cyberpunk: {
    name: 'Cyberpunk',
    icon: 'cpu',
    parameters: {
      multiplier: -1,
      subtractor: '110%',
      saturation: '60%',
      neutralSaturation: '10%',
      roles: {
        // As `dark`: the stack has to be pinned or the inversion turns it upside down.
        page: neutral(11),
        surface: neutral(15),
        surfaceSunken: neutral(8),
        surfaceRaised: neutral(21),
        // A bright accent needs a dark label: white measures 3.5:1 on it, near-black 4.8.
        onAccent: neutral(10),
      },
    },
  },

  /**
   * A near-neutral dark, for the channels template. Built from measurements of a real chat client
   * rather than by eye — see `apps/we-preview/scripts/measure.mjs`.
   *
   * Two things it demonstrates about the theme system, one comfortable and one not.
   *
   * **The parameters carry most of it.** The reference's neutrals are barely tinted (about 5%
   * saturation on a blue hue) where WE's dark preset runs 20% on whatever the primary hue is,
   * which is why our render came out visibly purple against it. `neutralHue` + `neutralSaturation`
   * fix that outright, and the accent is one more number.
   *
   * **The lightness ramp cannot.** The scale steps evenly — 100%, 95%, 90%, 80% — so with any
   * single `subtractor` the gap from page to rail always equals the gap from page to raised
   * surface. The reference's gaps are 3.5 and 6. No parameter can express an uneven ramp, so the
   * three surfaces are pinned as roles instead. That is what roles are *for*, and this is the first
   * theme to need them for it — but it is worth naming as a limit rather than a feature: a theme
   * wanting a different rhythm between its surfaces has to leave the parametric system to get it.
   *
   * The pins stay parametric in hue and saturation, so changing `neutralHue` still moves the whole
   * theme together. Only the lightnesses are fixed, because the lightnesses are the design.
   */
  channels: {
    name: 'Channels',
    icon: 'hash',
    parameters: {
      primaryHue: 235,
      neutralHue: 240,
      saturation: '85%',
      neutralSaturation: '6%',
      multiplier: -1,
      subtractor: '106%',
      roles: {
        page: neutral(11),
        surface: neutral(11),
        surfaceSunken: neutral(7.5),
        surfaceRaised: neutral(17),
        surfaceHover: neutral(15),
        surfaceActive: neutral(20),
        border: neutral(20),
        borderStrong: neutral(26),
        text: neutral(100),
        textMuted: neutral(72),
        textFaint: neutral(53),
        overlay: 'hsl(var(--we-color-neutral-hue) var(--we-color-neutral-saturation) 4% / 72%)',
        shadowColor: neutral(2),
      },
      controlRadius: '4px',
      surfaceRadius: '8px',
      inputRadius: '8px',
      shadowIntensity: 'subtle',
    },
  },

  /**
   * A light, quiet theme for the timeline template — the other reference, and the opposite problem.
   *
   * Almost the whole design is one flat white with hairline rules; there is no card, no elevation
   * and no shadow anywhere in the column. What carries it is the *accent* and the type, so the only
   * numbers that matter much are the blue and how faint a divider can get without vanishing.
   *
   * `shadowIntensity: 'flat'` is doing real work here: every surface primitive still wants to cast
   * something, and a timeline that shadows its rows stops reading as a single sheet.
   */
  timeline: {
    name: 'Timeline',
    icon: 'list-dashes',
    parameters: {
      primaryHue: 203,
      neutralHue: 210,
      saturation: '89%',
      neutralSaturation: '9%',
      multiplier: 1,
      subtractor: '0%',
      roles: {
        page: '#ffffff',
        surface: '#ffffff',
        surfaceSunken: neutral(97),
        surfaceRaised: '#ffffff',
        surfaceHover: neutral(97),
        surfaceActive: neutral(94),
        border: neutral(94),
        borderStrong: neutral(85),
        text: neutral(6),
        textMuted: neutral(44),
        textFaint: neutral(55),
        accent: 'hsl(203 89% 53%)',
        // Was '#ffffff', which measures 2.7:1 on that blue — the theme shipped a primary button
        // label below AA. Near-black measures 6.2. See contrast.test.ts.
        onAccent: neutral(10),
      },
      controlRadius: 'var(--we-radius-pill)',
      surfaceRadius: '16px',
      inputRadius: 'var(--we-radius-pill)',
      shadowIntensity: 'flat',
    },
  },
} as const satisfies Record<string, ThemePreset>;

export type ThemeName = keyof typeof THEME_PRESETS;

export const THEME_NAMES = Object.keys(THEME_PRESETS) as ThemeName[];

export function isThemeName(value: string): value is ThemeName {
  return value in THEME_PRESETS;
}

// The vocabulary and its mapping live beside the presets — one JS entry for the package.
export type { ThemeOverrides, ThemeRole } from './overrides';
export { migrateOverrides, parseOverrides, THEME_SCHEMA_VERSION } from './migrate';
export {
  applyThemeVars,
  DARK_SURFACES,
  isDarkPolarity,
  reconcileSurfaces,
  roleVar,
  surfacesForPolarity,
  themeToStyle,
} from './themeStyles';
