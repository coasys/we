/**
 * Reading a theme written against an older vocabulary.
 *
 * The reason this is worth testing carefully is that the failure it prevents is *silent*: an
 * unknown role key is ignored, so a theme published to a marketplace before a rename keeps looking
 * almost right while one relationship stops being honoured. Nobody reports that; they conclude the
 * theme was never very good.
 */
import { describe, expect, it } from 'vitest';

import { migrateOverrides, parseOverrides, THEME_SCHEMA_VERSION } from './migrate';
import type { ThemeOverrides } from './overrides';

/** A theme as it would have been stored before versioning existed. */
const v1 = (roles: Record<string, string>): ThemeOverrides => ({ primaryHue: 220, roles }) as ThemeOverrides;

describe('the 1 → 2 rename', () => {
  it('moves the old accent foreground to onAccent', () => {
    const out = migrateOverrides(v1({ accentText: '#ffffff' }));
    expect(out.roles).toEqual({ onAccent: '#ffffff' });
  });

  it('moves the old accent-as-text to accentText', () => {
    const out = migrateOverrides(v1({ accentStrong: '#0a3d91' }));
    expect(out.roles).toEqual({ accentText: '#0a3d91' });
  });

  /*
    Both at once is the case a sequential rename gets wrong: `accentText → onAccent` followed by
    `accentStrong → accentText` would move the first value into the second's slot and lose one of
    them. They are applied as a single map for that reason, and this is the test that says so.
  */
  it('keeps both apart when a theme pinned both', () => {
    const out = migrateOverrides(v1({ accentText: '#ffffff', accentStrong: '#0a3d91' }));
    expect(out.roles).toEqual({ onAccent: '#ffffff', accentText: '#0a3d91' });
  });

  it('renames the inverse foreground too', () => {
    expect(migrateOverrides(v1({ textInverse: '#fafafa' })).roles).toEqual({ onInverse: '#fafafa' });
  });

  it('leaves roles it does not rename exactly where they were', () => {
    const out = migrateOverrides(v1({ page: '#101820', surfaceSunken: '#0b1218' }));
    expect(out.roles).toEqual({ page: '#101820', surfaceSunken: '#0b1218' });
  });

  it('leaves everything that is not a role alone', () => {
    expect(migrateOverrides(v1({ accentText: '#fff' })).primaryHue).toBe(220);
  });
});

describe('versioning', () => {
  it('stamps what it migrated, so it is not migrated twice', () => {
    const once = migrateOverrides(v1({ accentText: '#ffffff' }));
    expect(once.schemaVersion).toBe(THEME_SCHEMA_VERSION);
    expect(migrateOverrides(once)).toEqual(once);
  });

  it('leaves a current theme untouched', () => {
    const current = { schemaVersion: THEME_SCHEMA_VERSION, roles: { onAccent: '#fff' } } as ThemeOverrides;
    expect(migrateOverrides(current)).toBe(current);
  });

  /*
    A theme from a newer build is returned as-is rather than run through migrations written for
    something else. It renders with whatever this build understands, which is the graceful half of
    a failure that has no good half.
  */
  it('does not try to migrate a theme from the future', () => {
    const future = { schemaVersion: 99, roles: { somethingNew: 'red' } } as unknown as ThemeOverrides;
    expect(migrateOverrides(future)).toBe(future);
  });
});

describe('parseOverrides', () => {
  it('parses and migrates in one step', () => {
    const stored = JSON.stringify({ roles: { accentStrong: '#0a3d91' } });
    expect(parseOverrides(stored).roles).toEqual({ accentText: '#0a3d91' });
  });

  it('treats an absent theme as no overrides rather than a crash', () => {
    expect(parseOverrides(null)).toEqual({});
    expect(parseOverrides('')).toEqual({});
  });

  it('survives a corrupt blob', () => {
    // An unthemed theme is survivable and visible; a white screen is neither.
    expect(parseOverrides('{not json')).toEqual({});
  });
});
