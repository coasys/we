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

import { CHROMA_CEILING, CHROMA_PER_SATURATION } from '@we/tokens';

import { THEME_SCHEMA_VERSION } from './migrate';
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
/**
 * A pinned neutral at an exact lightness, in OKLCH.
 *
 * The chroma is derived the same way the ramp derives it — the theme's saturation, tapered by how
 * close the lightness sits to either end — so a pin picks up a theme's neutral tint instead of
 * going flat grey. Written out here rather than read from a variable because `calc()` cannot take
 * `min()` over a percentage and divide it into the unitless number a chroma has to be.
 */
const neutral = (lightness: number) => {
  const taper = 2 * Math.min(lightness / 100, 1 - lightness / 100);
  return `oklch(${lightness}% calc(min(var(--we-color-neutral-saturation) * ${CHROMA_PER_SATURATION}, ${CHROMA_CEILING}) * ${taper.toFixed(4)}) var(--we-color-neutral-hue))`;
};

export const THEME_PRESETS = {
  light: {
    name: 'Light',
    icon: 'sun',
    parameters: {
      schemaVersion: THEME_SCHEMA_VERSION,
      polarity: 'light',
      lightnessFloor: '0%',
      lightnessCeiling: '100%',
      saturation: 97,
      neutralSaturation: 16,
    },
  },
  dark: {
    name: 'Dark',
    icon: 'moon',
    // 112 rather than 100 so the darkest step lands short of pure black — and further short than
    // the 108 it used to be. WCAG adds a constant 0.05 to both sides of a contrast ratio, which
    // compresses every ratio measured against a near-black background: at 108 the muted text on a
    // card came to 4.41:1, and no choice of *step* fixes that, because the step above is far darker
    // than muted text should be in a light theme. Lifting the floor is what the ratio responds to.
    // The role override is the first step past that approximation: in dark, a raised surface gets
    // *lighter* instead of casting a shadow — a relationship the uniform inversion cannot express.
    parameters: {
      schemaVersion: THEME_SCHEMA_VERSION,
      polarity: 'dark',
      lightnessFloor: '12%',
      lightnessCeiling: '112%',
      saturation: 81,
      neutralSaturation: 32,
      roles: {
        // The surface stack is derived from `page` now — see the note in @we/tokens' role.ts. This
        // theme pinned four lightnesses that the formula reproduces to within a point, which is
        // what suggested the formula.
        // White on this accent measures 3.6:1; the dark end measures 4.7. See contrast.test.ts.
        onAccent: neutral(21.6),
      },
    },
  },
  black: {
    name: 'Black',
    icon: 'square',
    parameters: {
      schemaVersion: THEME_SCHEMA_VERSION,
      polarity: 'dark',
      lightnessFloor: '0%',
      lightnessCeiling: '100%',
      saturation: 81,
      neutralSaturation: 32,
      /*
        The one theme that still has to state its stack, and for a reason no formula can route
        around: its page is pure black, and a +0.045 OKLCH step from there rounds to the same 8-bit
        sRGB value. At the floor there is no room for the relationship, so the numbers are the
        design. Built upwards from the page rather than around it, for the same reason.
      */
      roles: {
        page: neutral(0.0),
        surface: neutral(15.8),
        surfaceSunken: neutral(11.6),
        surfaceRaised: neutral(21.6),
        /*
          One step lighter than the vocabulary's default, and only here.

          WCAG adds 0.05 to both sides of a ratio, so against a literal black card the denominator
          is essentially that constant and the only way to move the ratio is to lift the text. At
          the default step muted text measures 3.43:1; this clears AA. Every other theme sits far
          enough off the floor not to need it.
        */
        /*
          The status roles, a step further out, and only here.

          A filled control needs to sit away from the middle of the ramp or no label reads on it —
          and `black` runs the full 0–100, which makes its dead zone the widest of any theme. The
          shared 700 lands at 58% for this ramp; 800 clears it. The same reasoning as `accent`
          moving off 600, applied to a theme whose range is the reason.
        */
      },
    },
  },
  retro: {
    name: 'Retro',
    icon: 'floppy-disk',
    parameters: {
      schemaVersion: THEME_SCHEMA_VERSION,
      primaryHue: 271,
      polarity: 'light',
      lightnessFloor: '0%',
      lightnessCeiling: '100%',
      saturation: 97,
      neutralSaturation: 16,
    },
  },
  cyberpunk: {
    name: 'Cyberpunk',
    icon: 'cpu',
    parameters: {
      schemaVersion: THEME_SCHEMA_VERSION,
      polarity: 'dark',
      lightnessFloor: '10%',
      lightnessCeiling: '110%',
      saturation: 97,
      neutralSaturation: 16,
      roles: {
        // A bright accent needs a dark label: white measures 3.5:1 on it, near-black 4.8.
        onAccent: neutral(21.6),
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
      primaryHue: 266,
      neutralHue: 266,
      saturation: 100,
      neutralSaturation: 10,
      schemaVersion: THEME_SCHEMA_VERSION,
      polarity: 'dark',
      lightnessFloor: '6%',
      lightnessCeiling: '106%',
      roles: {
        page: neutral(22.7),
        surface: neutral(22.7),
        surfaceSunken: neutral(18.7),
        surfaceRaised: neutral(29.0),
        /*
          Pinned, like 's. This theme's ramp puts the shared accent step in the band where
          no label reads — the derivation would move it, but a designed theme should say what its
          accent *is* rather than have it inferred. L 53% is the lightness that carries a label
          across rest, hover and pressed; the hue and chroma are the theme's own.
        */
        accent: 'oklch(53% 0.18 266)',
        // Same band, same reason — this theme's ramp puts the shared danger step where no label reads.
        danger: 'oklch(53% 0.16 27)',
        surfaceHover: neutral(27.0),
        surfaceActive: neutral(32.1),
        border: neutral(32.1),
        borderStrong: neutral(38.0),
        text: neutral(100.0),
        textFaint: neutral(62.4),
        overlay:
          'oklch(4% calc(min(var(--we-color-neutral-saturation) * 0.0035, 0.18) * 0.08) var(--we-color-neutral-hue) / 72%)',
        shadowColor: neutral(11.6),
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
      primaryHue: 245,
      neutralHue: 255,
      saturation: 100,
      neutralSaturation: 15,
      schemaVersion: THEME_SCHEMA_VERSION,
      polarity: 'light',
      lightnessFloor: '0%',
      lightnessCeiling: '100%',
      roles: {
        page: '#ffffff',
        surface: '#ffffff',
        surfaceSunken: neutral(97.7),
        surfaceRaised: '#ffffff',
        surfaceHover: neutral(97.7),
        surfaceActive: neutral(95.4),
        border: neutral(95.4),
        borderStrong: neutral(88.5),
        text: neutral(17.0),
        textFaint: neutral(64.1),
        accent: 'hsl(203 89% 53%)',
        // Was '#ffffff', which measures 2.7:1 on that blue — the theme shipped a primary button
        // label below AA. Near-black measures 6.2. See contrast.test.ts.
        onAccent: neutral(21.6),
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
