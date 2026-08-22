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
  relativeLuminance,
  type Rgba,
  rgbToOklch,
} from '@we/design-utils';
import type { ColorLightnessToken } from '@we/tokens';
import { chromaTaper, color, RAMP, role } from '@we/tokens';
import { describe, expect, it } from 'vitest';

import type { ThemeOverrides, ThemeRole } from './overrides';
import { THEME_PRESETS, type ThemeName } from './presets';
import { AUTO_CONTRAST, deriveLegible, pickReadableForeground } from './themeStyles';

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
  { fg: 'onStatus', bg: 'danger', level: 'ui', what: 'a destructive button label' },
  { fg: 'dangerText', bg: 'dangerSurface', level: 'body', what: 'danger text on its tint' },
  { fg: 'successText', bg: 'successSurface', level: 'body', what: 'success text on its tint' },
  { fg: 'warningText', bg: 'warningSurface', level: 'body', what: 'warning text on its tint' },
];

const HUE_DEFAULTS: Record<string, number> = { primary: 220, success: 142, warning: 38, danger: 4, neutral: 220 };

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
  const pinned = /^oklch\(([\d.]+)%\s+(.+?)\s+var\(--we-color-([a-z]+)-hue\)\s*(?:\/\s*([\d.%]+))?\)$/.exec(
    value.trim(),
  );
  if (pinned) {
    const [, l, chromaExpr, hueFamily, alpha] = pinned;
    const lightnessFraction = parseFloat(l) / 100;
    const taper = 2 * Math.min(lightnessFraction, 1 - lightnessFraction);
    const chroma = /^[\d.]+$/.test(chromaExpr)
      ? parseFloat(chromaExpr)
      : (saturationOf('neutral', theme) / 100) * maxChromaFor(0.6, hueOf('neutral', theme)) * taper;
    return parseColor(`oklch(${l}% ${chroma.toFixed(4)} ${hueOf(hueFamily, theme)}${alpha ? ` / ${alpha}` : ''})`);
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
const RELATIVE = /^oklch\(from\s+var\(--we-role-([a-z-]+)\)\s+calc\(l\s*([+-])\s*([\d.]+)\)\s+c\s+h\)$/;

function roleColor(name: ThemeRole, theme: ThemeOverrides, seen = new Set<string>()): Rgba | null {
  /*
    A derived foreground is resolved the way the runtime derives it, not from its declared default.

    `onAccent` and `onStatus` are chosen by measurement at theme-apply time, so checking their
    static value asks a question nobody sees the answer to — and gets it wrong in both directions:
    it fails a theme whose bright fill would have been given a dark label, and it would pass one
    where the derivation had no good option. Only when the theme has not pinned it, since a pin is
    the author overruling the derivation.
  */
  const derived = AUTO_CONTRAST.find((entry) => entry.fg === name);
  if (derived && !theme.roles?.[name] && !seen.has(name)) {
    const fills = derived.against
      .map((fill) => roleColor(fill, theme, new Set([...seen, name])))
      .filter((c): c is Rgba => !!c);
    if (fills.length) {
      const ends = [neutralAt(98, theme), neutralAt(10, theme)];
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
    const [, base, sign, amount] = relative;
    // A role defined in terms of itself would spin forever; a theme can do that by hand.
    if (seen.has(name)) return null;
    const camel = base.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) as ThemeRole;
    const from = roleColor(camel, theme, new Set([...seen, name]));
    if (!from) return null;
    const { l, c, h } = rgbToOklch(from);
    const moved = Math.min(1, Math.max(0, l + (sign === '-' ? -1 : 1) * parseFloat(amount)));
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

/** The two ends of this theme's neutral ramp — the candidates the runtime chooses between. */
function neutralAt(l: number, theme: ThemeOverrides): string {
  const taper = 2 * Math.min(l / 100, 1 - l / 100);
  const chroma = (saturationOf('neutral', theme) / 100) * maxChromaFor(0.6, hueOf('neutral', theme)) * taper;
  return `oklch(${l}% ${chroma.toFixed(4)} ${hueOf('neutral', theme)})`;
}

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
