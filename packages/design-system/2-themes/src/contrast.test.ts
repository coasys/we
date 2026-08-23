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
import { chromaTaper, color, FILL_LIGHTNESS, RAMP, role } from '@we/tokens';
import { describe, expect, it } from 'vitest';

import type { ThemeOverrides, ThemeRole } from './overrides';
import { THEME_PRESETS, type ThemeName } from './presets';
import {
  DERIVED_FILLS,
  deriveRoleVars,
  FILL_LABELS,
  LEGIBLE_FOREGROUNDS,
  pickReadableForeground,
  stateDelta,
} from './themeStyles';

const PAIRS: { fg: ThemeRole; bg: ThemeRole; level: ContrastLevel; what: string }[] = [
  { fg: 'text', bg: 'page', level: 'body', what: 'body text on the page' },
  { fg: 'text', bg: 'surface', level: 'body', what: 'body text on a card' },
  { fg: 'text', bg: 'surfaceSunken', level: 'body', what: 'body text in a well' },
  { fg: 'textMuted', bg: 'surface', level: 'body', what: 'muted text on a card' },
  /*
    `ui`, not `body`. `textFaint` is placeholders, disabled labels and decorative icons — none of
    which is a paragraph, and holding them to Lc 60 would mean a "faint" that is not faint.

    Added because the coverage check below asked for it: it is corrected at apply time like every
    other foreground, and until now nothing measured the result, so the correction could have
    stopped working and no test would have said so.
  */
  { fg: 'textFaint', bg: 'surface', level: 'ui', what: 'placeholder text on a card' },
  { fg: 'accentText', bg: 'surface', level: 'body', what: 'an accented heading on a card' },
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
  /*
    And on an ordinary card, which is where a status message usually is — an error under a form
    field, a tick in a settings row. Only the tint was asserted, and in a dark theme the card is the
    harder of the two, so three built-ins sat just under the floor on the commoner placement:
    `dark` 58.5, `cyberpunk` 58.6, `black` 59.9 and 59.5.
  */
  { fg: 'dangerText', bg: 'surface', level: 'body', what: 'danger text on a card' },
  { fg: 'successText', bg: 'surface', level: 'body', what: 'success text on a card' },
  { fg: 'warningText', bg: 'surface', level: 'body', what: 'warning text on a card' },
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
    /*
      The same expression the generated CSS builds: a step's lightness, the theme's saturation scaled
      by the taper *at that lightness*, and the family's hue.

      "At that lightness" is the part this had wrong. It tapered from the raw table entry while the
      CSS tapers from the post-ramp value, so the two agreed only where the ramp is the identity —
      `light` and `retro` — and diverged 2.3× on `dark`'s step 200. Against Chrome the post-ramp form
      is exact and the raw one was 12 rgb out on blue.
    */
    const l = lightness(step, theme);
    const chroma = (saturationOf(family, theme) / 100) * maxChromaFor(0.6, hueOf(family, theme)) * chromaTaper(l / 100);
    return parseColor(`oklch(${l}% ${chroma.toFixed(4)} ${hueOf(family, theme)})`);
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
    The lightness is either a literal (`55%`) or a fill's own variable with the theme's value as its
    fallback (`calc(var(--we-accent-lightness, 55) * 1%)`, and the same for danger/success/warning).
    The second form is what lets an author brighten a fill without pinning the role — which would
    discard the label and state derivations that keep it usable. It resolves to the theme's setting
    when it has one, or to the fallback the preset wrote.

    The variable is captured rather than spelt out, so a fourth one added to `role.ts` is read here
    by existing instead of silently falling through to the literal branch and being measured at the
    wrong lightness.
  */
  const pinned =
    /^oklch\((?:([\d.]+)%|calc\(var\(--we-([a-z]+)-lightness,\s*([\d.]+)\)\s*\*\s*1%\))\s+(.+?)\s+var\(--we-color-([a-z]+)-hue\)\s*(?:\/\s*([\d.%]+))?\)$/.exec(
      value.trim(),
    );
  if (pinned) {
    const [, literalL, lightnessVar, fallbackL, chromaExpr, hueFamily, alpha] = pinned;
    const declaredL = lightnessVar
      ? (theme[`${lightnessVar}Lightness` as keyof ThemeOverrides] as number | undefined)
      : undefined;
    const l = literalL ?? String(declaredL ?? parseFloat(fallbackL));
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
          // Mirrors applyChromaCeilings: a fill's ceiling follows its own lightness where the theme
          // moved it, and the family's shared FILL_LIGHTNESS where it did not.
          maxChromaFor(
            declaredL !== undefined
              ? declaredL / 100
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

/**
 * Every role a theme resolves to, by running the *actual* derivation over resolved base colours.
 *
 * ## Why this stopped being modelled here
 *
 * The suite used to re-implement the pipeline: it found a fill that no label could sit on and moved
 * it, chose a label against where it landed, walked a foreground until it cleared. Each of those was
 * a second copy of a decision the runtime also makes, and the copies drifted — repeatedly, and once
 * catastrophically. `applyThemeVars` spent an entire round doing *nothing at all*, because every
 * derivation in it read a role through `getPropertyValue` and got back an unevaluated token stream;
 * this suite modelled the derivations it believed were running and reported green throughout. Two
 * smaller drifts followed (a chroma factor ignored, a ceiling read at the wrong lightness), each
 * caught only because a recorded value happened to move.
 *
 * So the split is now along the one line that is inherent: **resolving a declared value to a colour**
 * is done differently by necessity — the runtime asks a browser, this does the arithmetic — and
 * **everything decided from those colours** is the same call, `deriveRoleVars`. There is no second
 * implementation left to drift.
 *
 * The three passes mirror `applyThemeVars` exactly, and in the same order:
 *
 * 1. Resolve every role's declared value (a pin, or the vocabulary's default).
 * 2. Run the pipeline, which mutates the fills and labels in place and returns what to write.
 * 3. Resolve the interaction states, which could not be done in pass 1: which way a hover travels
 *    depends on the label chosen in pass 2.
 */
const themeColorCache = new WeakMap<ThemeOverrides, Map<ThemeRole, Rgba>>();

function themeColors(theme: ThemeOverrides): Map<ThemeRole, Rgba> {
  const cached = themeColorCache.get(theme);
  if (cached) return cached;

  const declared = (name: ThemeRole): string | undefined =>
    theme.roles?.[name] ?? (role as Record<string, string>)[name];

  /*
    A declared value to a colour, following `oklch(from var(--we-role-x) calc(l ± n) c h)` through
    whatever role it names. The state form is skipped here and handled in pass 3.
  */
  const resolveDeclared = (name: ThemeRole, seen: Set<string>): Rgba | null => {
    const value = declared(name);
    if (!value) return null;
    // A role stated as another role — `surface: var(--we-role-page)`, how a theme says "this has no
    // elevation" rather than freezing the page's lightness into three more places.
    const alias = /^var\(--we-role-([a-z-]+)\)$/.exec(value.trim());
    if (alias) {
      if (seen.has(name)) return null;
      const to = alias[1].replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) as ThemeRole;
      return resolveDeclared(to, new Set([...seen, name]));
    }
    const relative = RELATIVE.exec(value.trim());
    if (!relative) return resolve(value, theme);

    const [, base, sign, amount, stateKey] = relative;
    if (stateKey) return null; // pass 3
    if (seen.has(name)) return null; // a role defined in terms of itself
    const camel = base.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) as ThemeRole;
    const from = resolveDeclared(camel, new Set([...seen, name]));
    if (!from) return null;
    const { l, c, h } = rgbToOklch(from);
    const moved = Math.min(1, Math.max(0, l + (sign === '-' ? -1 : 1) * parseFloat(amount)));
    return { ...oklchToRgb(moved, c, h), a: from.a };
  };

  // ── 1. Declared values ────────────────────────────────────────────────────────────────────────
  const colors = new Map<ThemeRole, Rgba>();
  for (const name of Object.keys(role) as ThemeRole[]) {
    const c = resolveDeclared(name, new Set());
    if (c) colors.set(name, c);
  }

  // ── 2. The pipeline the runtime runs ──────────────────────────────────────────────────────────
  const written = deriveRoleVars(colors, theme, String(hueOf('neutral', theme)));
  for (const [prop, value] of Object.entries(written)) {
    if (!prop.startsWith('--we-role-')) continue;
    const name = prop.slice('--we-role-'.length).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) as ThemeRole;
    const parsed = parseColor(String(value));
    if (parsed) colors.set(name, parsed);
  }

  // ── 3. Interaction states, which depend on the labels chosen above ────────────────────────────
  for (const name of Object.keys(role) as ThemeRole[]) {
    if (colors.has(name)) continue;
    const value = declared(name);
    const relative = value ? RELATIVE.exec(value.trim()) : null;
    if (!relative) continue;
    const [, base, , , stateKey, stateFamily] = relative;
    if (!stateKey) continue;
    const camel = base.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) as ThemeRole;
    const from = colors.get(camel);
    const pairing = FILL_LABELS.find((entry) => entry.fill === stateFamily);
    const label = pairing ? colors.get(pairing.label) : undefined;
    if (!from || !label) continue;
    const { l, c, h } = rgbToOklch(from);
    const moved = Math.min(1, Math.max(0, l + stateDelta(from, label, stateKey as 'hover' | 'active')));
    colors.set(name, { ...oklchToRgb(moved, c, h), a: from.a });
  }

  themeColorCache.set(theme, colors);
  return colors;
}

function roleColor(name: ThemeRole, theme: ThemeOverrides): Rgba | null {
  return themeColors(theme).get(name) ?? null;
}

/**
 * Coverage, not a second copy of the runtime's table.
 *
 * This used to be `LEGIBLE_PAIRS`, the suite's own list of which foreground is measured against
 * which surface — one of several tables kept in step with `themeStyles` by hand, and the species of
 * duplication that let the suite report green over derivations that were not running at all. The
 * pipeline is called directly now, so the list is dead as an input.
 *
 * It is not dead as a question. `PAIRS` above is hand-written, so a role added to the runtime's
 * derivations is corrected at apply time and asserted by nothing — the derivation would keep it
 * legible and no test would notice if it stopped. So the check is inverted: every fill the runtime
 * derives, and every label it derives for one, has to appear in `PAIRS`.
 */
describe('what the derivations cover, the assertions cover', () => {
  const asserted = new Set(PAIRS.flatMap((pair) => [pair.fg, pair.bg]));

  it.each(DERIVED_FILLS)('%s is measured against the label derived for it', (fill) => {
    const pairing = FILL_LABELS.find((entry) => entry.fill === fill);
    expect(pairing, `${fill} is derived but has no label in FILL_LABELS`).toBeTruthy();
    expect(
      PAIRS.some((pair) => pair.bg === fill && pair.fg === pairing!.label),
      `nothing asserts ${pairing!.label} on ${fill} — the derivation could stop and no test would say so`,
    ).toBe(true);
  });

  /*
    Read from the runtime's own table rather than restated, so a foreground added there arrives here
    as a failing test rather than as silent absence.

    Every *background* too, not just the foreground: the correction takes the worst of the surfaces
    a role appears on, so a background listed there and unasserted here is one the theme is being
    held to and nothing is checking. That is exactly how `dangerText` on a card came to be a
    near-miss in three themes — the pair existed in the editor's audit and in no test.
  */
  it.each(LEGIBLE_FOREGROUNDS)('$fg is measured on every surface it is corrected against', ({ fg, on }) => {
    expect(asserted.has(fg), `${fg} is corrected at apply time but never measured`).toBe(true);
    for (const bg of on) {
      expect(
        PAIRS.some((pair) => pair.fg === fg && pair.bg === bg),
        `${fg} is corrected against ${bg} and nothing asserts that pair`,
      ).toBe(true);
    }
  });
});

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
/**
 * A pin that lands where the theme's own parameters already land is not stating anything.
 *
 * Every preset here was authored by measuring a rendered screen and writing the numbers down, which
 * is a reasonable way to start and leaves behind pins that were never decisions. Seven of them were:
 * `channels` pinned its page, sunken surface, hover tint and text within half a point of what its
 * own floor and ceiling produce, and `timeline` pinned a sunken surface within 1.2. All seven cost
 * the theme its ability to follow its parameters — move the ramp and a pinned role stays put — and
 * none of them changed a single rendered colour, which a browser confirmed after they were dropped.
 *
 * Stated as "removing this pin changes the colour" rather than as a lightness comparison, because
 * that is the question: a pin earns its place by making a difference. The check runs the same
 * resolver the rest of the suite does, so it accounts for the relative surfaces and the pipeline.
 *
 * One rgb unit of tolerance — below that the browser paints the same pixel, and the pin is decoration
 * around a number the theme already had.
 */
/**
 * The resolver against the browser, on recorded measurements.
 *
 * Everything else in this suite grades *from* `resolve()`, so a resolver that models a colour the
 * browser does not paint reports confidently on the wrong theme, and nothing internal disagrees with
 * it. That is not hypothetical: `resolve()` tapered chroma from the raw step table while the emitted
 * CSS tapers from the post-ramp lightness, so the two agreed only where the ramp is the identity —
 * `light` and `retro` — and were 2.3× apart on `dark`'s step 200. Every dark theme's scale positions
 * were being measured against a colour 12 rgb units off, for the whole of this branch, with 397
 * tests green.
 *
 * These numbers were read out of Chrome by painting each variable on a probe element and sampling
 * the canvas — the same harness the theme comparisons use. They are the only assertion here that an
 * internal change cannot satisfy by moving both sides at once.
 *
 * A tolerance of 1 covers rounding between the browser's OKLCH conversion and ours; a real
 * divergence is not 1 unit, it is 12.
 */
const MEASURED: Record<string, Record<string, [number, number, number]>> = {
  light: { 'neutral-200': [203, 203, 211], 'neutral-700': [76, 75, 94], 'primary-500': [126, 104, 228] },
  dark: { 'neutral-200': [59, 57, 82], 'neutral-700': [184, 183, 201], 'primary-500': [127, 114, 206] },
  black: { 'neutral-200': [37, 35, 56], 'neutral-700': [162, 160, 188], 'primary-500': [106, 83, 198] },
  cyberpunk: { 'neutral-200': [67, 66, 81], 'neutral-700': [187, 187, 197], 'primary-500': [132, 114, 225] },
  channels: { 'neutral-200': [54, 58, 66], 'neutral-700': [182, 185, 191], 'primary-500': [79, 120, 230] },
};

describe('the resolver agrees with the browser', () => {
  for (const [themeName, steps] of Object.entries(MEASURED)) {
    const theme = THEME_PRESETS[themeName as ThemeName].parameters as ThemeOverrides;
    it.each(Object.entries(steps))(`${themeName} %s`, (token, expected) => {
      const got = resolve(`var(--we-color-${token})`, theme);
      expect(got, `${token} did not resolve`).toBeTruthy();
      const channels = [got!.r, got!.g, got!.b].map(Math.round);
      const off = channels.map((c, i) => Math.abs(c - expected[i]));
      expect(Math.max(...off), `resolved rgb(${channels}) where Chrome paints rgb(${expected})`).toBeLessThanOrEqual(1);
    });
  }
});

describe.each(Object.keys(THEME_PRESETS) as ThemeName[])('%s pins', (name) => {
  const theme = THEME_PRESETS[name].parameters as ThemeOverrides;
  const pinned = Object.keys(theme.roles ?? {}) as ThemeRole[];

  // `light`, `black`, `retro` and `cyberpunk` pin nothing at all — `it.each([])` is an empty suite,
  // which vitest reports as a failure, so they get one assertion saying what is true of them.
  if (!pinned.length) {
    it('pins nothing — the parameters carry the whole theme', () => {
      expect(pinned).toEqual([]);
    });
    return;
  }

  it.each(pinned)('%s pin changes what the theme renders', (pin) => {
    /*
      A pin stated over another role is exempt, and the exemption is the point rather than a let-off.
      This asks whether a pin is a frozen measurement; `surface: var(--we-role-page)` is not a number
      at all, it is the statement "this theme has no elevation", and it holds when the page moves.
      Timeline's two are the case: they resolve to white today only because the parametric default is
      `page + 10%`, which at a white page is L 110% and clamps back. Judged on today's colour they
      look redundant, and dropping them would leave two surfaces floating pure white over any page
      the theme later darkened — which is the failure the old spelling actually had.
    */
    if (/^var\(--we-role-/.test(theme.roles?.[pin] ?? '')) return;
    const withPin = roleColor(pin, theme);
    const rest = { ...theme.roles } as Record<string, string>;
    delete rest[pin];
    const withoutPin = roleColor(pin, { ...theme, roles: rest } as ThemeOverrides);
    // A role with no parametric default at all cannot be compared — the pin is the only value there.
    if (!withPin || !withoutPin) return;
    const distance = Math.max(
      Math.abs(withPin.r - withoutPin.r),
      Math.abs(withPin.g - withoutPin.g),
      Math.abs(withPin.b - withoutPin.b),
    );
    expect(distance, `pinning '${pin}' produces the same colour the parameters already do`).toBeGreaterThan(1);
  });
});

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
