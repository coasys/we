/**
 * Theme migration — reading a theme written against an older vocabulary.
 *
 * ## Why a theming system needs this at all
 *
 * In most design systems the theme and the code ship together, so renaming a token is a rename plus
 * its call sites. Here a theme is *data*: authored in the browser, saved to a space, published to a
 * marketplace, installed by somebody else, carried in a share link. It outlives the build that made
 * it, and it is not ours to edit.
 *
 * That makes a rename a compatibility problem rather than a refactor. And the failure is silent in
 * the worst way — an unknown key is simply ignored, so a theme that pinned `accentText` keeps
 * looking almost right while one relationship quietly stops being honoured. Nobody files that bug;
 * they just think the theme was never very good.
 *
 * So the vocabulary carries a version, and every read runs forward from whatever version the theme
 * was written against. The theme on disk is left alone until something saves it, which is what lets
 * an old marketplace theme work in a new app without anybody republishing it.
 *
 * ## Adding a migration
 *
 * Append a function to `MIGRATIONS`. Its index is the version it upgrades *from*, so the first entry
 * takes a v1 theme to v2. Never edit an existing one — a theme in the wild has already been read by
 * the old one, and rewriting history here means two people's copies diverge.
 */
import type { ThemeOverrides, ThemeRole } from './overrides';

/** A theme with no version was written before versioning existed. */
const INITIAL_VERSION = 1;

type Versioned = ThemeOverrides & { schemaVersion?: number };

/**
 * Rename a set of role keys in one pass, keeping any the theme did not use.
 *
 * One pass, not one per rename, because a rename map can be a permutation: `accentText` becomes
 * `onAccent` *and* `accentStrong` becomes `accentText` in the same step, so applying them in
 * sequence would move the first value into the second's slot and lose one of them. Every key is
 * read from the original object and written once.
 */
function renameRoles(overrides: Versioned, renames: Record<string, string>): Versioned {
  if (!overrides.roles) return overrides;
  const roles: Partial<Record<ThemeRole, string>> = {};
  for (const [key, value] of Object.entries(overrides.roles)) {
    roles[(renames[key] ?? key) as ThemeRole] = value;
  }
  return { ...overrides, roles };
}

/**
 * Index `n` upgrades a theme from version `n + 1` to `n + 2`.
 *
 * 1 → 2: the accent and inverse foregrounds are renamed to the `on<Fill>` form.
 *
 * `accentText` meant "text *on* the accent" but read as "accent-coloured text", and `accentStrong`
 * meant the second of those but read as "a stronger accent" — the theme editor had to label them
 * "On accent" and "Accent text" to be usable, which is the tell. `on<Fill>` says which is which
 * without a label, and frees `accentText` to mean the obvious thing.
 */
const MIGRATIONS: ((overrides: Versioned) => Versioned)[] = [
  (overrides) =>
    renameRoles(overrides, {
      // Order matters only in the sense that these are applied as one map, never in sequence:
      // `accentText` becomes `onAccent` and `accentStrong` becomes `accentText` in the same pass,
      // so the old `accentText` cannot be re-read as the new one.
      accentText: 'onAccent',
      accentStrong: 'accentText',
      textInverse: 'onInverse',
    }),

  /*
    v2 → v3: the ramp moved from HSL to OKLCH.

    Two things change in a stored theme and neither announces itself. A hue is an angle in a
    particular space, and the two spaces disagree by up to 45 degrees in the warm end — so a theme
    that said `warningHue: 45` meant amber and would now mean a yellow-green. And saturation stopped
    being a percentage string, because OKLCH takes an absolute chroma and `calc()` cannot divide a
    percentage into the unitless number one has to be.

    The hue conversion runs through the colour the old angle actually produced, so a theme keeps its
    identity rather than being nudged to the nearest round number.
  */
  (overrides) => {
    const next: Versioned = { ...overrides };
    for (const key of ['primaryHue', 'successHue', 'warningHue', 'dangerHue', 'neutralHue'] as const) {
      const value = next[key];
      if (typeof value === 'number') next[key] = hslHueToOklch(value);
    }
    for (const key of ['saturation', 'neutralSaturation'] as const) {
      const value = next[key] as unknown;
      if (typeof value === 'string') next[key] = parseFloat(value) || 0;
    }
    return next;
  },

  /*
    v3 → v4: the ramp says where its ends are, instead of encoding them.

    `multiplier` was only ever 1 or -1 — a boolean typed as a number — and `subtractor` meant
    "reflect the ramp and offset it by this much", which is not a thing anybody can picture. What
    the pair actually described is the polarity and the two lightnesses the ramp runs between, so
    that is what a theme states now. The arithmetic is identical; the conversion is exact.

    `subtractor: '112%'` with `multiplier: -1` meant a floor at 12% — which is how tuning a dark
    theme came to involve guessing at a number and looking at the result.
  */
  (overrides) => {
    const legacy = overrides as Versioned & { multiplier?: number; subtractor?: string };
    if (legacy.multiplier === undefined && legacy.subtractor === undefined) return overrides;

    const multiplier = legacy.multiplier ?? 1;
    const subtractor = parseFloat(legacy.subtractor ?? '0%') || 0;
    const next: Versioned = { ...overrides };
    delete (next as { multiplier?: number }).multiplier;
    delete (next as { subtractor?: string }).subtractor;

    next.polarity = multiplier === -1 ? 'dark' : 'light';
    /*
      Converted exactly, including the part that looks wrong.

      A dark theme's ceiling comes out above 100% — `subtractor: '112%'` becomes a ceiling of 112 —
      because that is what the old ramp did: it ran past white and only the last step clamped. The
      alternative, clamping the ceiling to 100 here, is *not* the same ramp; it redistributes every
      step in between and takes about nine points of lightness off a dark theme's body text.

      A ceiling above 100 is legal and means "the top of this ramp is white, and the steps near it
      are compressed against it". A theme is free to state a real one instead, and the built-ins
      will when they are next tuned.
    */
    const [floor, ceiling] = multiplier === -1 ? [subtractor - 100, subtractor] : [-subtractor, 100 - subtractor];
    next.lightnessFloor = `${Math.max(0, floor)}%`;
    next.lightnessCeiling = `${ceiling}%`;
    return next;
  },
];

/**
 * The OKLCH hue of the colour an HSL hue used to produce.
 *
 * Converted rather than copied: OKLCH is perceptually spaced, so its angles do not line up with
 * HSL's — 45 (amber) becomes 90, while 220 (blue) becomes 263. Evaluated at mid lightness and
 * moderate saturation, which is where a theme's identity actually lives; hue barely moves with
 * either, so one sample is enough.
 */
export function hslHueToOklch(hue: number): number {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const k = (n: number) => (n + hue / 30) % 12;
  const a = 0.5 * 0.5; // saturation 50%, lightness 50%
  const ch = (n: number) => 0.5 - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const [r, g, b] = [ch(0), ch(8), ch(4)].map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const deg = (Math.atan2(B, A) * 180) / Math.PI;
  return Math.round(deg < 0 ? deg + 360 : deg);
}

/** The vocabulary version this build writes. */
export const THEME_SCHEMA_VERSION = INITIAL_VERSION + MIGRATIONS.length;

/**
 * Bring a theme's overrides up to the current vocabulary.
 *
 * Idempotent, and safe on a theme from the future: a version this build does not recognise is
 * returned untouched rather than mangled by migrations that were written for something else. It
 * will render with whatever this build understands, which is the graceful half of the failure.
 */
export function migrateOverrides(overrides: ThemeOverrides): ThemeOverrides {
  const versioned = overrides as Versioned;
  const from = versioned.schemaVersion ?? INITIAL_VERSION;
  if (from >= THEME_SCHEMA_VERSION) return overrides;

  let result = versioned;
  for (let v = from; v < THEME_SCHEMA_VERSION; v++) result = MIGRATIONS[v - INITIAL_VERSION](result);
  return { ...result, schemaVersion: THEME_SCHEMA_VERSION };
}

/**
 * Parse a stored overrides blob and migrate it — the one door themes come in through.
 *
 * Every `JSON.parse(theme.overrides)` in the app is this, so a theme cannot enter the running
 * system at an old version by coming in through a path somebody forgot about.
 */
export function parseOverrides(json: string | null | undefined): ThemeOverrides {
  if (!json) return {};
  try {
    return migrateOverrides(JSON.parse(json) as ThemeOverrides);
  } catch {
    // A corrupt blob is not worth taking the app down for; an unthemed theme is survivable and
    // visible, where a white screen is neither.
    console.error('ThemeMigration: could not parse theme overrides; falling back to none.');
    return {};
  }
}
