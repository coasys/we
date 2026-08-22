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
import { CONTRAST_MINIMUM, type ContrastLevel, contrastRatio, parseColor, type Rgba } from '@we/design-utils';
import { color, role } from '@we/tokens';
import { describe, expect, it } from 'vitest';

import type { ThemeOverrides, ThemeRole } from './overrides';
import { THEME_PRESETS, type ThemeName } from './presets';
import { pickReadableForeground } from './themeStyles';

const PAIRS: { fg: ThemeRole; bg: ThemeRole; level: ContrastLevel; what: string }[] = [
  { fg: 'text', bg: 'page', level: 'body', what: 'body text on the page' },
  { fg: 'text', bg: 'surface', level: 'body', what: 'body text on a card' },
  { fg: 'text', bg: 'surfaceSunken', level: 'body', what: 'body text in a well' },
  { fg: 'textMuted', bg: 'surface', level: 'body', what: 'muted text on a card' },
  { fg: 'onAccent', bg: 'accent', level: 'body', what: 'a primary button label' },
  { fg: 'onInverse', bg: 'surfaceInverse', level: 'body', what: 'tooltip text' },
  { fg: 'dangerText', bg: 'dangerSurface', level: 'body', what: 'danger text on its tint' },
  { fg: 'successText', bg: 'successSurface', level: 'body', what: 'success text on its tint' },
  { fg: 'warningText', bg: 'warningSurface', level: 'body', what: 'warning text on its tint' },
];

const HUE_DEFAULTS: Record<string, number> = { primary: 220, success: 142, warning: 38, danger: 4, neutral: 220 };

/** The lightness the CSS would compute for one step, given a theme's multiplier and subtractor. */
function lightness(step: string, theme: ThemeOverrides): number {
  const base = parseFloat(color.lightness[step as keyof typeof color.lightness]);
  const subtractor = parseFloat(theme.subtractor ?? '0%');
  const multiplier = theme.multiplier ?? 1;
  return Math.min(100, Math.max(0, (base - subtractor) * multiplier));
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
  return parseFloat((family === 'neutral' ? theme.neutralSaturation : theme.saturation) ?? '50%');
}

/** Resolve a role's value — a token reference, a pinned lightness, or a literal — to RGB. */
function resolve(value: string, theme: ThemeOverrides): Rgba | null {
  const token = /^var\(--we-color-([a-z]+)-(\d+)\)$/.exec(value.trim());
  if (token) {
    const [, family, step] = token;
    return parseColor(`hsl(${hueOf(family, theme)} ${saturationOf(family, theme)}% ${lightness(step, theme)}%)`);
  }
  const pinned = /^hsl\(var\(--we-color-([a-z]+)-hue\)\s+var\([^)]+\)\s+([\d.]+)%\s*(?:\/\s*([\d.%]+))?\)$/.exec(
    value.trim(),
  );
  if (pinned) {
    const [, family, l, alpha] = pinned;
    return parseColor(
      `hsl(${hueOf(family, theme)} ${saturationOf(family, theme)}% ${l}%${alpha ? ` / ${alpha}` : ''})`,
    );
  }
  return parseColor(value);
}

function roleColor(name: ThemeRole, theme: ThemeOverrides): Rgba | null {
  const value = theme.roles?.[name] ?? (role as Record<string, string>)[name];
  return value ? resolve(value, theme) : null;
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
