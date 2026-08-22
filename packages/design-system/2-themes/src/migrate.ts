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
];

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
