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

import { CHROMA_CEILING } from '@we/tokens';

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
  // The same chroma expression the ramp uses — a pin that computes its colour a different way is a
  // second model, and the two drift. This one was 1.5× more chromatic than the ramp at the same
  // saturation, which is why the modal scrim came out violet.
  return `oklch(${lightness}% calc(var(--we-color-neutral-saturation) / 100 * var(--we-color-neutral-chroma-max, ${CHROMA_CEILING}) * ${taper.toFixed(4)}) var(--we-color-neutral-hue))`;
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
    /*
      The four numbers, fitted rather than guessed.

      The ramp move to OKLCH changed how every step lands, and this theme came out noticeably darker
      and less blue than it had been. Rather than nudge until it looked right, the old theme's
      rendered colours were measured and the parameters solved for: a least-squares fit of floor and
      ceiling over eight neutral roles lands within 0.7 lightness points across all of them, and the
      saturations are fitted the same way against what the tint and the accent used to be.

      `neutralSaturation` was refitted once the chroma taper was corrected — the first fit was made
      against a ramp whose colour was inverted end for end, so it came out half again too high. The
      weighting is by how much of a screen each step paints: an unweighted fit treats `neutral-900`,
      a few pixels of text, as equal to `neutral-50`, which is the entire background.

      The ceiling is constrained so that no step *clips*. At 125% the top of the ramp ran past white
      and `text` landed on pure #ffffff — which costs almost nothing in a least-squares fit and is
      the thing somebody notices, because a clipped step is not "one point brighter", it is the same
      colour as every step above it. Every label, icon and ghost-button glyph in the app inherits
      `text`, so the whole interface read as harsher than it had been.
    */
    parameters: {
      schemaVersion: THEME_SCHEMA_VERSION,
      polarity: 'dark',
      lightnessFloor: '20%',
      lightnessCeiling: '121%',
      saturation: 75,
      neutralSaturation: 26,
      /*
        Two statements. Everything else in this theme is derived from them and from the four
        numbers above, which is the whole of what a preset should be.

        It reached eight pins while being brought back to the appearance it had, and seven of those
        turned out to be compensating for two defects rather than saying anything: fills defaulted
        to step 700, which inverts to a pale lavender in a dark theme, and a stated label switched
        the fill derivation off instead of constraining it. Both are fixed in the layers below, and
        the pins that were working around them are gone.
      */
      roles: {
        /*
          The identity colour, stated exactly.

          The default now sits at its own lightness rather than on the ramp (see FILL_LIGHTNESS in
          @we/tokens), which lands at rgb(127,114,206) — about twenty units off the indigo this
          theme is known by. So it is worth stating; it is not worth deriving something close and
          calling it the same colour. This is the one thing a theme really does have to say.
        */
        accent: 'oklch(55.3% 0.16 288)',
        /*
          A near-black label on the accent, which is this theme's character.

          Left to choose, `applyAutoContrast` picks white here — white measures Lc 80 on this indigo
          against near-black's 29 — and it would be right on the numbers and wrong about the theme.
          A mid-tone fill carrying dark text is what makes this read as itself rather than as a
          generic dark theme.

          Deliberate and measured: Lc 29 against a UI floor of 45. The editor shows that live per
          pair and `contrast.test.ts` records it by name, so the suite still fails on any further
          drift. It is the only recorded breach left in the whole suite.

          Note this covers the *accent* only. The status labels are left to derive, and pick white on the
          status fills — which is what keeps the destructive button a true red. Stating dark there
          too would be consistent-looking and would cost the colour: a fill has to climb to about
          L 0.75 to carry near-black at the floor, and a red that light is pink. Consistency between
          the primary and destructive buttons is not worth a destructive button that does not read
          as destructive.
        */
        onAccent: 'oklch(17.9% 0.0165 296.2)',
        /*
          Not stated here, and each for a reason worth keeping:

          - **The status fills.** At step 500 they are already the mid-tones this theme wants, and
            they now follow the ramp rather than a pin — so moving `saturation` moves them.
          - **The elevation stack.** This theme used to pin four lightnesses and the formula in
            role.ts reproduces them to within a couple of units, which is what suggested the formula.
            A theme that states its whole stack cannot be tuned, only rewritten.
          - **The status labels, `accentHover`, `accentActive`.** All derived from what is above.
        */
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
      /*
        No pins, and the one it used to carry is worth recording as a warning.

        It pinned `onAccent` to near-black, on the note "a bright accent needs a dark label: white
        measures 3.5:1 on it, near-black 4.8". Both figures were true and both were about a *fill
        that no longer exists*: with fills defaulting to step 700 this theme's accent inverted to a
        pale lavender, and a pale lavender does need a dark label.

        Fills now sit at their own lightness, so the accent is the vivid violet the theme is named
        for — and white on it measures Lc 82. Keeping the pin would have held a dark label on a
        saturated violet and, worse, dragged the fill back up to pale: a stated label constrains the
        fill derivation now, so the pin was actively pulling the accent toward the colour it was
        written to compensate for. Measured: chroma 0.12 with the pin, 0.26 without it.

        The general lesson: a pin written against a defect outlives the defect. This one was three
        role-layer changes stale and nothing but a measurement would have said so.
      */
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
        accent: 'oklch(40% 0.18 266)',
        // Same band, same reason — this theme's ramp puts the shared danger step where no label reads.
        danger: 'oklch(40% 0.16 27)',
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
        /*
          `onAccent` is not pinned, and the pin that was here is a good illustration of why the two
          contrast metrics cannot be mixed.

          It held a near-black label, on the note that white measured 2.7:1 on this blue and
          near-black 6.2 — both correct WCAG 2 figures. Under APCA the order reverses: white is
          Lc 59 and near-black Lc 48, because WCAG's flat +0.05 penalises light-on-mid pairings in
          a way that does not match what a reader experiences. The derivation now scores with APCA,
          the same metric the suite grades with, and picks white.

          Which is also the right answer by eye — white on a bright blue is what this kind of
          timeline looks like everywhere it appears.
        */
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
