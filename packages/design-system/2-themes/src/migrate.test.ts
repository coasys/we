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
    // The hue is not left alone — v3 converts it to an OKLCH angle — so this asserts it survived as
    // *a* hue rather than as the same number. What it must not do is drop it.
    expect(typeof migrateOverrides(v1({ accentText: '#fff' })).primaryHue).toBe('number');
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

/**
 * v2 → v3: the ramp moved to OKLCH, and two stored values change meaning.
 *
 * A hue is an angle in a particular space and the two disagree — by 45 degrees in the warm end. A
 * theme that stored `warningHue: 45` meant amber; read as an OKLCH angle it is a yellow-green. This
 * is the silent-failure case the versioning exists for: nothing errors, the theme just quietly
 * stops being the theme somebody made.
 */
describe('the 2 → 3 move to OKLCH', () => {
  const v2 = (overrides: Record<string, unknown>) => ({ schemaVersion: 2, ...overrides }) as ThemeOverrides;

  it('converts a hue to the angle that names the same colour', () => {
    // Blue: HSL 220 is OKLCH 263, not 220.
    expect(migrateOverrides(v2({ primaryHue: 220 })).primaryHue).toBe(263);
    // Amber moves furthest, which is why leaving it would be most visible.
    expect(migrateOverrides(v2({ warningHue: 45 })).warningHue).toBe(90);
  });

  it('converts every hue a theme can set, and leaves other numbers alone', () => {
    const out = migrateOverrides(v2({ successHue: 142, dangerHue: 4, neutralHue: 220, fontScale: 1.25 }));
    expect(out.successHue).toBe(152);
    expect(out.dangerHue).toBe(27);
    expect(out.neutralHue).toBe(263);
    expect(out.fontScale).toBe(1.25);
  });

  it('unquotes saturation, which is a chroma multiplier now rather than a percentage', () => {
    const out = migrateOverrides(v2({ saturation: '85%', neutralSaturation: '6%' }));
    expect(out.saturation).toBe(85);
    expect(out.neutralSaturation).toBe(6);
  });

  it('is idempotent — a converted hue is not converted again', () => {
    const once = migrateOverrides(v2({ primaryHue: 220, saturation: '50%' }));
    expect(migrateOverrides(once)).toEqual(once);
  });
});

/**
 * v3 → v4: the ramp states where its ends are.
 *
 * The conversion has to be *exact*, not merely sensible — a dark theme's ceiling comes out above
 * 100% because that is what the old ramp did, and rounding it down to white redistributes every
 * step in between.
 */
describe('the 3 → 4 move to an explicit lightness range', () => {
  const v3 = (o: Record<string, unknown>) => ({ schemaVersion: 3, ...o }) as unknown as ThemeOverrides;

  it('reads a light theme as a full-range light ramp', () => {
    const out = migrateOverrides(v3({ multiplier: 1, subtractor: '0%' }));
    expect(out.polarity).toBe('light');
    expect(out.lightnessFloor).toBe('0%');
    expect(out.lightnessCeiling).toBe('100%');
  });

  it('turns a dark theme’s subtractor into the floor it always meant', () => {
    // `subtractor: '112%'` with multiplier -1 is "floor at 12%" — which nobody could tell by reading.
    const out = migrateOverrides(v3({ multiplier: -1, subtractor: '112%' }));
    expect(out.polarity).toBe('dark');
    expect(out.lightnessFloor).toBe('12%');
  });

  it('keeps a ceiling above white rather than clamping it, because the ramp really did run past', () => {
    expect(migrateOverrides(v3({ multiplier: -1, subtractor: '112%' })).lightnessCeiling).toBe('112%');
  });

  it('drops the keys it replaced, so nothing reads them by accident', () => {
    const out = migrateOverrides(v3({ multiplier: -1, subtractor: '112%' })) as Record<string, unknown>;
    expect(out.multiplier).toBeUndefined();
    expect(out.subtractor).toBeUndefined();
  });

  it('leaves a theme that set neither alone', () => {
    const out = migrateOverrides(v3({ primaryHue: 263 }));
    expect(out.polarity).toBeUndefined();
    expect(out.primaryHue).toBe(263);
  });
});

describe('the 4 → 5 tidy of the control surface', () => {
  const v4 = (o: Record<string, unknown>) => ({ schemaVersion: 4, ...o }) as unknown as ThemeOverrides;

  it('renames the density keys that each said "padding" differently', () => {
    const out = migrateOverrides(v4({ surfaceSpacing: '20px', inputSpacing: '4px 8px' })) as Record<string, unknown>;
    expect(out.surfacePadding).toBe('20px');
    expect(out.inputPadding).toBe('4px 8px');
    expect(out.surfaceSpacing).toBeUndefined();
  });

  it('says what controlHeight actually was', () => {
    expect((migrateOverrides(v4({ controlHeight: '4px' })) as Record<string, unknown>).controlHeightOffset).toBe('4px');
  });

  /*
    `ringColor` and the `focus` role wrote the same variable with no stated precedence. Moving the
    value into the role keeps the author's choice and leaves one way to say it.
  */
  it('folds ringColor into the focus role rather than dropping it', () => {
    const out = migrateOverrides(v4({ ringColor: '#ff00ff' })) as Record<string, unknown>;
    expect((out.roles as Record<string, string>).focus).toBe('#ff00ff');
    expect(out.ringColor).toBeUndefined();
  });

  it('lets a role the theme already pinned win over the old key', () => {
    const out = migrateOverrides(v4({ ringColor: '#ff00ff', roles: { focus: '#00ff00' } }));
    expect(out.roles?.focus).toBe('#00ff00');
  });
});
