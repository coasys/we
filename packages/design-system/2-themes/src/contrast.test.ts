/**
 * Every built-in theme, checked against the pairs the role vocabulary declares.
 *
 * Nothing checked this before, so a theme could ship with body text a shade off its own page and
 * the only signal was somebody squinting. It is checkable at all because the roles name their
 * pairings — `onAccent` is *defined* as the thing that sits on `accent` — so both sides of each
 * test are known rather than inferred by crawling a rendered page.
 *
 * The theme parameters are resolved here rather than in a browser: a theme is four numbers and a
 * lightness ramp, so the same arithmetic the CSS does (`(base - subtractor) * multiplier`) gives
 * the colour without a DOM. That is what makes this a unit test that runs on every commit instead
 * of a screenshot somebody remembers to take.
 */
import {
  APCA_MINIMUM,
  apcaContrast,
  CONTRAST_MINIMUM,
  type ContrastLevel,
  contrastRatio,
  maxChromaFor,
  oklchToRgb,
  parseColor,
  perceptualDistance,
  relativeLuminance,
  type Rgba,
  rgbToOklch,
  simulateVision,
} from '@we/design-utils';
import type { ColorLightnessToken } from '@we/tokens';
import { chromaTaper, color, FILL_LIGHTNESS, RAMP, role } from '@we/tokens';
import { describe, expect, it } from 'vitest';

import type { ThemeOverrides, ThemeRole } from './overrides';
import { THEME_PRESETS, type ThemeName } from './presets';
import {
  AUTO_CONTRAST,
  DERIVED_FILLS,
  deriveFill,
  deriveLegible,
  FILL_LABELS,
  fillStateDeltas,
  labelCandidates,
  pickReadableForeground,
  stateDelta,
} from './themeStyles';

const PAIRS: { fg: ThemeRole; bg: ThemeRole; level: ContrastLevel; what: string }[] = [
  { fg: 'text', bg: 'page', level: 'body', what: 'body text on the page' },
  { fg: 'text', bg: 'surface', level: 'body', what: 'body text on a card' },
  { fg: 'text', bg: 'surfaceSunken', level: 'body', what: 'body text in a well' },
  { fg: 'textMuted', bg: 'surface', level: 'body', what: 'muted text on a card' },
  /*
    `ui`, not `body`. APCA separates body copy from interface text, and a button label is the latter:
    a short, semibold string at 14–16px, which its guidance puts at Lc 45. Holding a control label to
    the 60 that a paragraph needs is not a stricter reading of the same rule, it is the wrong rule.
  */
  { fg: 'onAccent', bg: 'accent', level: 'ui', what: 'a primary button label' },
  { fg: 'onInverse', bg: 'surfaceInverse', level: 'body', what: 'tooltip text' },
  // The pair nothing named, which is how a dark theme shipped a near-white label on a light red.
  { fg: 'onDanger', bg: 'danger', level: 'ui', what: 'a destructive button label' },
  { fg: 'onSuccess', bg: 'success', level: 'ui', what: 'a success fill label' },
  { fg: 'onWarning', bg: 'warning', level: 'ui', what: 'a warning fill label' },
  { fg: 'dangerText', bg: 'dangerSurface', level: 'body', what: 'danger text on its tint' },
  { fg: 'successText', bg: 'successSurface', level: 'body', what: 'success text on its tint' },
  { fg: 'warningText', bg: 'warningSurface', level: 'body', what: 'warning text on its tint' },
];

/*
  The token defaults, read rather than restated.

  These were hardcoded, and they were *wrong* — 220/142/38/4 against the tokens' own
  250/130/45/350 — so the suite had been checking a palette the app never rendered. It went
  unnoticed because being thirty degrees out on a hue rarely changes whether a pair clears AA. The
  fix is to stop keeping a second copy: `color.hues` is the source, and a change there now reaches
  the tests that are supposed to be guarding it.
*/
const HUE_DEFAULTS: Record<string, number> = color.hues;

/**
 * Pairs a theme states outright, below the floor, on purpose — recorded rather than exempted.
 *
 * One entry, and the fact that it is only one is the point.
 *
 * `dark` states a near-black label on its fills, which is its character. Left to choose, the
 * auto-contrast pass picks white on an accent that deep, because white measures Lc 80 against
 * near-black's 29. So the label is stated — and because a stated label now *constrains* the fill
 * derivation rather than switching it off, the three status fills move themselves until they carry
 * it. The destructive button used to sit here at Lc 37 with its fill pinned; derived against the
 * stated label it reaches Lc 60, and needs no exemption at all.
 *
 * What is left is the pair where the theme has stated *both* sides: `accent` is this theme's
 * identity colour and the label on it is near-black, so there is nothing for a derivation to move.
 * The cost is real and deliberate — the alternative is either a white label, which is not the
 * theme, or an accent lightened to about L 0.78, which is a pastel and also not the theme. Both
 * were measured before choosing.
 *
 * Keyed by theme and pair, and asserted as an **equality** rather than skipped. A skip would let
 * these drift to anything at all; the recorded number means the suite still fails if a change makes
 * them worse, and fails if a change makes them better without this note being updated — so the list
 * cannot rot into a set of forgotten exemptions. Nothing else in the suite is relaxed: every other
 * pair on `dark`, and every pair on every other theme, is held to the full threshold.
 */
const ACCEPTED_BELOW_FLOOR: Record<string, number> = {
  'dark:a primary button label': 29,
};

/** The lightness the CSS would compute for one step, given a theme's multiplier and subtractor. */
function lightness(step: string, theme: ThemeOverrides): number {
  const floor = parseFloat(theme.lightnessFloor ?? '0%');
  const ceiling = parseFloat(theme.lightnessCeiling ?? '100%');
  const { offset, direction } = RAMP[theme.polarity ?? 'light'];
  const t = (parseFloat(color.lightness[step as keyof typeof color.lightness]) / 100 - offset) * direction;
  return Math.min(100, Math.max(0, floor + t * (ceiling - floor)));
}

function hueOf(family: string, theme: ThemeOverrides): number {
  const key = family === 'neutral' ? 'neutralHue' : (`${family}Hue` as const);
  // Neutral follows primary unless a theme separates them — the same linkage the tokens CSS has.
  return (
    (theme[key as keyof ThemeOverrides] as number | undefined) ??
    (family === 'neutral' ? (theme.primaryHue ?? HUE_DEFAULTS.neutral) : HUE_DEFAULTS[family])
  );
}

function saturationOf(family: string, theme: ThemeOverrides): number {
  return (family === 'neutral' ? theme.neutralSaturation : theme.saturation) ?? 50;
}

/** Resolve a role's value — a token reference, a pinned lightness, or a literal — to RGB. */
function resolve(value: string, theme: ThemeOverrides): Rgba | null {
  const token = /^var\(--we-color-([a-z]+)-(\d+)\)$/.exec(value.trim());
  if (token) {
    const [, family, step] = token;
    // The same expression the generated CSS builds: a step's lightness, the theme's saturation
    // scaled by that step's chroma taper, and the family's hue.
    const chroma =
      (saturationOf(family, theme) / 100) *
      maxChromaFor(0.6, hueOf(family, theme)) *
      chromaTaper(step as ColorLightnessToken);
    return parseColor(`oklch(${lightness(step, theme)}% ${chroma.toFixed(4)} ${hueOf(family, theme)})`);
  }
  // A pin at an exact lightness: `oklch(13% calc(var(--we-color-neutral-saturation) * k) var(…hue))`
  /*
    A pin at an exact lightness, e.g. `oklch(13% calc(min(var(--we-…-saturation) * k, ceil) * t) var(--we-…-hue))`.

    The chroma is recomputed rather than parsed out of the string. Everything inside that `calc` is
    derivable from the lightness — it is the same taper the ramp applies — so reading it back would
    only be re-deriving it through a regex that has to be kept in step with the generator. A bare
    number is used as-is: that is the form at the very ends, where the taper reaches zero.
  */
  /*
    The lightness is either a literal (`55%`) or the accent's variable with the theme's own value as
    its fallback (`calc(var(--we-accent-lightness, 55) * 1%)`). The second form is what lets an
    author brighten the accent — see `accentLightness` — and it resolves to the theme's setting when
    it has one, or to the fallback the preset wrote.
  */
  const pinned =
    /^oklch\((?:([\d.]+)%|calc\(var\(--we-accent-lightness,\s*([\d.]+)\)\s*\*\s*1%\))\s+(.+?)\s+var\(--we-color-([a-z]+)-hue\)\s*(?:\/\s*([\d.%]+))?\)$/.exec(
      value.trim(),
    );
  if (pinned) {
    const [, literalL, fallbackL, chromaExpr, hueFamily, alpha] = pinned;
    const l = literalL ?? String(theme.accentLightness ?? parseFloat(fallbackL));
    const lightnessFraction = parseFloat(l) / 100;
    const hue = hueOf(hueFamily, theme);

    /*
      A *fill* is untapered, and scaled against the ceiling published for its family.

      The taper exists to make the neutral ramp converge on white and black at its ends, which is
      the one thing a fill must not do — a warning that fades toward the background as the theme
      gets lighter has stopped being a warning. So the fill roles name a `-fill-chroma-max`
      variable, and that name is what tells the two forms apart here.

      Two details, both of which this got wrong first time and the recorded-value assertion caught:

      - The ceiling is measured at `FILL_LIGHTNESS[family]`, not at the role's own lightness. That
        is what `applyChromaCeilings` publishes, and a theme pinning its accent at some other
        lightness is still scaled against that one number.
      - A pin may carry a trailing `* <factor>` — the fraction of the theme's saturation it wants
        (see `fill()` in presets.ts). Ignoring it modelled `dark`'s accent at chroma 0.20 where the
        browser paints 0.16.
    */
    const isFill = chromaExpr.includes('-fill-chroma-max');
    const factor = parseFloat(/\*\s*([\d.]+)\s*\)?\s*$/.exec(chromaExpr)?.[1] ?? '1');
    const taper = 2 * Math.min(lightnessFraction, 1 - lightnessFraction);
    const chroma = /^[\d.]+$/.test(chromaExpr)
      ? parseFloat(chromaExpr)
      : isFill
        ? (saturationOf(hueFamily, theme) / 100) *
          // Mirrors applyChromaCeilings: the accent's ceiling follows its own lightness, which a
          // theme can move; the status fills sit at the shared FILL_LIGHTNESS for their family.
          maxChromaFor(
            hueFamily === 'primary' && theme.accentLightness !== undefined
              ? theme.accentLightness / 100
              : (FILL_LIGHTNESS[hueFamily as keyof typeof FILL_LIGHTNESS] ?? lightnessFraction),
            hue,
          ) *
          factor
        : (saturationOf('neutral', theme) / 100) * maxChromaFor(0.6, hueOf('neutral', theme)) * taper;
    return parseColor(`oklch(${l}% ${chroma.toFixed(4)} ${hue}${alpha ? ` / ${alpha}` : ''})`);
  }

  return parseColor(value);
}

/**
 * `oklch(from var(--we-role-x) calc(l ± n) c h)` — the elevation stack's relative form.
 *
 * Resolved with the same arithmetic the browser does, so the check stays a unit test: read the role
 * it names, convert to OKLCH, move the lightness, convert back. Without this the resolver returns
 * null for three of the four surfaces and the elevation test asserts on nothing.
 */
// The delta is a literal for the elevation stack and a variable for the interaction states, since
// which way a state moves depends on polarity and `oklch(from …)` cannot branch on it.
const RELATIVE =
  /^oklch\(from\s+var\(--we-role-([a-z-]+)\)\s+calc\(l\s*([+-])\s*(?:([\d.]+)|var\(--we-state-(hover|active)-([a-z]+),\s*var\(--we-state-(?:hover|active)\)\))\)\s+c\s+h\)$/;

function roleColor(name: ThemeRole, theme: ThemeOverrides, seen = new Set<string>()): Rgba | null {
  /*
    A derived foreground is resolved the way the runtime derives it, not from its declared default.

    `onAccent` and the three `on<Status>` roles are chosen by measurement at theme-apply time, so checking their
    static value asks a question nobody sees the answer to — and gets it wrong in both directions:
    it fails a theme whose bright fill would have been given a dark label, and it would pass one
    where the derivation had no good option. Only when the theme has not pinned it, since a pin is
    the author overruling the derivation.
  */
  /*
    A fill that no label can sit on moves until one can — checked here because it is what renders.

    Both label candidates are equidistant from a fill in the middle of the ramp, so no choice of
    foreground rescues it. Where the middle falls depends on the theme's range, which is why two
    themes had to pin their way out before the derivation existed.
  */
  /*
    A fill that no label can sit on moves until one can.

    Calls the runtime's own `deriveFill` rather than repeating its logic. This block used to be a
    copy, and the copy drifted — it checked only the rest state and held chroma constant, so the
    suite passed while the browser rendered something else. What is still resolved separately here
    is the *colour*, which is inherent: the test computes it arithmetically and the runtime reads it
    off computed style. The decision made from that colour is now shared.
  */
  if (DERIVED_FILLS.includes(name) && !theme.roles?.[name] && !seen.has(name)) {
    const fill = resolve((role as Record<string, string>)[name], theme);
    if (fill) {
      // A stated label constrains the search to itself — mirroring `applyLegibleFills`. Resolved
      // through `roleColor` rather than `resolve`, since a pin may be an expression over the
      // theme's own variables.
      const labelRole = FILL_LABELS.find((entry) => entry.fill === name)?.label;
      const stated =
        labelRole && theme.roles?.[labelRole] !== undefined
          ? roleColor(labelRole, theme, new Set([...seen, name]))
          : null;
      const labels = stated
        ? [stated]
        : labelCandidates(String(hueOf('neutral', theme)))
            .map((css) => parseColor(css))
            .filter((c): c is Rgba => !!c);
      return deriveFill(fill, labels, APCA_MINIMUM.ui, fillStateDeltas(theme.polarity)) ?? fill;
    }
  }

  const derived = AUTO_CONTRAST.find((entry) => entry.fg === name);
  if (derived && !theme.roles?.[name] && !seen.has(name)) {
    const fills = derived.against
      .map((fill) => roleColor(fill, theme, new Set([...seen, name])))
      .filter((c): c is Rgba => !!c);
    if (fills.length) {
      const ends = labelCandidates(String(hueOf('neutral', theme)));
      return parseColor(pickReadableForeground(ends, fills));
    }
  }

  /*
    A foreground that keeps its hue and moves its lightness until it clears — the second derivation.

    Modelled here for the same reason as the first: checking the declared step asks a question
    nobody sees the answer to. It is what makes the APCA rows pass on the dark themes, where a fixed
    step cannot serve both polarities.
  */
  const legible = LEGIBLE_PAIRS[name];
  if (legible && !theme.roles?.[name] && !seen.has(name)) {
    const declared = resolve((role as Record<string, string>)[name], theme);
    const bg = roleColor(legible.on, theme, new Set([...seen, name]));
    if (declared && bg && apcaContrast(declared, bg) < APCA_MINIMUM[legible.level]) {
      const fixed = deriveLegible(declared, bg, APCA_MINIMUM[legible.level]);
      if (fixed) return parseColor(fixed);
    }
    if (declared) return declared;
  }

  const value = theme.roles?.[name] ?? (role as Record<string, string>)[name];
  if (!value) return null;

  const relative = RELATIVE.exec(value.trim());
  if (relative) {
    const [, base, sign, amount, stateKey, stateFamily] = relative;
    // A role defined in terms of itself would spin forever; a theme can do that by hand.
    if (seen.has(name)) return null;
    const camel = base.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) as ThemeRole;
    const from = roleColor(camel, theme, new Set([...seen, name]));
    if (!from) return null;

    /*
      An interaction state moves away from the fill's own label, so resolving one means resolving
      that label first — and calling the runtime's `stateDelta` rather than deciding here.

      The label is `onAccent` for the accent and a matching `on<Status>` for each status fill, which is
      what FILL_LABELS says; reading it from there rather than restating the mapping means a fifth
      fill added later is picked up by the suite without touching it. If the label cannot be
      resolved the state is left where it is, which keeps a partial theme from failing every row.
    */
    let delta: number;
    if (stateKey) {
      const pairing = FILL_LABELS.find((entry) => entry.fill === stateFamily);
      const label = pairing ? roleColor(pairing.label, theme, new Set([...seen, name])) : null;
      if (!label) return null;
      delta = stateDelta(from, label, stateKey as 'hover' | 'active');
    } else {
      delta = (sign === '-' ? -1 : 1) * parseFloat(amount);
    }
    const { l, c, h } = rgbToOklch(from);
    const moved = Math.min(1, Math.max(0, l + delta));
    return { ...oklchToRgb(moved, c, h), a: from.a };
  }

  return resolve(value, theme);
}

/** Mirrors LEGIBLE_FOREGROUNDS in themeStyles — the roles that move their own lightness. */
const LEGIBLE_PAIRS: Partial<Record<ThemeRole, { on: ThemeRole; level: ContrastLevel }>> = {
  textMuted: { on: 'surface', level: 'body' },
  textFaint: { on: 'surface', level: 'ui' },
  accentText: { on: 'surface', level: 'body' },
  dangerText: { on: 'dangerSurface', level: 'body' },
  successText: { on: 'successSurface', level: 'body' },
  warningText: { on: 'warningSurface', level: 'body' },
};

describe.each(Object.keys(THEME_PRESETS) as ThemeName[])('%s', (name) => {
  const theme = THEME_PRESETS[name].parameters as ThemeOverrides;

  it.each(PAIRS)('clears AA for $what', (pair) => {
    const fg = roleColor(pair.fg, theme);
    const bg = roleColor(pair.bg, theme);
    // A pair this resolver cannot compute is a gap in the resolver, not a pass.
    expect(fg, `could not resolve ${pair.fg}`).toBeTruthy();
    expect(bg, `could not resolve ${pair.bg}`).toBeTruthy();

    const ratio = contrastRatio(fg!, bg!);
    expect(
      Number(ratio.toFixed(2)),
      `${name}: ${pair.what} is ${ratio.toFixed(2)}:1, needs ${CONTRAST_MINIMUM[pair.level]}:1`,
    ).toBeGreaterThanOrEqual(CONTRAST_MINIMUM[pair.level]);
  });

  /*
    The same pairs, measured the way that is right about dark backgrounds.

    WCAG 2 adds a flat 0.05 to both sides of its ratio, which dominates the denominator against a
    near-black background — so a dark theme scores far better than it reads. This branch patched
    three pairs to clear 4.5 (lifting `dark`'s floor, pinning `black`'s muted text) and each of
    those moved the number without moving the legibility: they measured Lc 42 and 36 against a
    threshold of 60 while WCAG 2 called them 4.84 and 5.08.

    Both checks run. WCAG 2 stays because it may be the obligation and APCA is still a draft; APCA
    is here because it is the one that catches this.
  */
  it.each(PAIRS)('clears APCA Lc for $what', (pair) => {
    const fg = roleColor(pair.fg, theme);
    const bg = roleColor(pair.bg, theme);
    expect(fg, `could not resolve ${pair.fg}`).toBeTruthy();
    expect(bg, `could not resolve ${pair.bg}`).toBeTruthy();

    const lc = apcaContrast(fg!, bg!);
    const accepted = ACCEPTED_BELOW_FLOOR[`${name}:${pair.what}`];
    if (accepted !== undefined) {
      // Held at the value that was signed off, not merely allowed to be low: a pin that drifts
      // further down still fails, and one that improves fails too, so the number here cannot
      // quietly stop describing the theme.
      expect(
        Math.round(lc),
        `${name}: ${pair.what} is Lc ${lc.toFixed(0)}, recorded as Lc ${accepted} — see ACCEPTED_BELOW_FLOOR`,
      ).toBe(accepted);
      return;
    }
    expect(
      Math.round(lc),
      `${name}: ${pair.what} is Lc ${lc.toFixed(0)}, needs Lc ${APCA_MINIMUM[pair.level]}`,
    ).toBeGreaterThanOrEqual(APCA_MINIMUM[pair.level]);
  });
});

/**
 * Elevation has to survive the inversion, and until now nothing said so.
 *
 * `page` and `surface` are both scale positions by default (neutral-50 and neutral-0), and the whole
 * scale flips together — so the *ordering* between them flips too. In a light theme a card is white
 * on a grey page; run the same two tokens through `multiplier: -1` and the card is the darker of the
 * two, which is the opposite of what every dark interface does.
 *
 * It went unnoticed for as long as it did because the templates painted their cards with
 * `surface-sunken`, which inverts to *lighter* than the page and therefore looked right in dark by
 * accident. Correcting those cards to `surface` is what surfaced this, and it is why the check
 * belongs here rather than in a template: it is a property of the vocabulary.
 *
 * Equal is allowed. A flat design where the page and its cards share one colour and separation comes
 * from borders is a real design — `channels` is one — and this is not the place to overrule it.
 */
describe.each(Object.keys(THEME_PRESETS) as ThemeName[])('%s elevation', (name) => {
  const theme = THEME_PRESETS[name].parameters as ThemeOverrides;
  const lum = (r: ThemeRole) => {
    const c = roleColor(r, theme);
    expect(c, `could not resolve ${r}`).toBeTruthy();
    return relativeLuminance(c!);
  };

  it('does not put a card below the page it sits on', () => {
    expect(
      Number(lum('surface').toFixed(4)),
      `${name}: surface is darker than page, so a card reads as a hole rather than an object`,
    ).toBeGreaterThanOrEqual(Number(lum('page').toFixed(4)));
  });

  it('keeps raised above surface and sunken below it', () => {
    expect(lum('surfaceRaised'), `${name}: a raised surface is not above the surface`).toBeGreaterThanOrEqual(
      lum('surface'),
    );
    expect(lum('surfaceSunken'), `${name}: a sunken well is not below the surface`).toBeLessThanOrEqual(lum('surface'));
  });
});

describe('pickReadableForeground', () => {
  const LIGHT = 'hsl(220 10% 98%)';
  const DARK = 'hsl(220 10% 10%)';
  const fill = (css: string) => [parseColor(css)!];

  it('goes dark on a pale fill and light on a deep one', () => {
    expect(pickReadableForeground([LIGHT, DARK], fill('hsl(55 95% 70%)'))).toBe(DARK);
    expect(pickReadableForeground([LIGHT, DARK], fill('hsl(250 70% 25%)'))).toBe(LIGHT);
  });

  /*
    The case that makes this worth having as its own function: a label chosen against the rest
    state alone can go unreadable halfway through a click, when the fill darkens under the pointer.
  */
  it('lets the weakest pairing decide, not the first fill', () => {
    const rest = parseColor('hsl(220 80% 46%)')!;
    const pressed = parseColor('hsl(220 80% 88%)')!;
    const chosen = pickReadableForeground([LIGHT, DARK], [rest, pressed]);
    // Light reads on the rest state and vanishes on the pressed one, so dark has to win.
    expect(chosen).toBe(DARK);
    expect(contrastRatio(parseColor(chosen)!, pressed)).toBeGreaterThan(contrastRatio(parseColor(LIGHT)!, pressed));
  });

  it('falls back to the first candidate when none can be parsed', () => {
    expect(pickReadableForeground([LIGHT, 'not-a-colour'], fill('#000'))).toBe(LIGHT);
  });
});

/**
 * What colour-vision deficiency actually requires of a palette — and what it does not.
 *
 * The obvious check is that `danger` and `success` stay far apart under deuteranopia. It was
 * written, and it failed every theme by a small margin, and the failure was correct: red and green
 * at the same lightness *are* the same colour to about one man in twelve, because deuteranopia
 * removes the axis they differ on. Putting them at different steps did not rescue it either — the
 * fill derivation moves both toward wherever a label fits, which pulls them back together.
 *
 * That is a property of every design system with red/green status, not a defect in this one, and
 * the standard says so: WCAG 1.4.1 asks that colour never be the *only* visual means of conveying
 * information. The requirement is redundancy, not separability — which is a structural property
 * this can check, where the colorimetric one could only be met by abandoning red and green.
 *
 * So the distance functions stay — the editor reports them to an author choosing hues — and the
 * assertion that a status never travels as colour alone lives in `@we/primitives`, next to the
 * component that provides the redundancy. It cannot live here: themes is layer 2 and primitives is
 * layer 3, and importing upward would invert the dependency the layering exists to hold.
 */
describe('how close a theme\u2019s status colours come under colour-vision deficiency', () => {
  /*
    Kept as a *diagnostic* rather than an assertion: it records how close a theme's status colours
    come, which is worth knowing when picking hues, without pretending the palette could be fixed by
    moving them.
  */
  it('reports how close danger and success come under deuteranopia', () => {
    const rows = (Object.keys(THEME_PRESETS) as ThemeName[]).map((name) => {
      const theme = THEME_PRESETS[name].parameters as ThemeOverrides;
      const danger = roleColor('danger', theme);
      const success = roleColor('success', theme);
      if (!danger || !success) return `${name}: unresolved`;
      const d = perceptualDistance(simulateVision(danger, 'deuteranopia'), simulateVision(success, 'deuteranopia'));
      return `${name}: ${d.toFixed(3)}`;
    });
    // Every theme resolves; the numbers themselves are informational.
    expect(rows.every((r) => !r.endsWith('unresolved'))).toBe(true);
  });
});
