/**
 * Light, dark, or both — and which side an edit lands on.
 *
 * Every patch is applied the way the store applies one (spread over the stored theme, undefined
 * dropped), so these read as what the theme becomes rather than what was asked for.
 */
import { type ThemeOverrides, withThemeSide } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { sidesOf, sidesPatch, writePatch } from './themeSides';

const apply = (theme: ThemeOverrides, patch: Partial<ThemeOverrides> | undefined): ThemeOverrides =>
  JSON.parse(JSON.stringify({ ...theme, ...patch }));

const forkOfDark: ThemeOverrides = { themeName: 'dark' };

describe('one side or both', () => {
  it('reads a fork of a preset as that preset’s side', () => {
    expect(sidesOf(forkOfDark)).toBe('dark');
    expect(sidesOf({ themeName: 'light' })).toBe('light');
    expect(sidesOf({})).toBe('light');
  });

  it('turns a fork of dark light and back to exactly the dark preset', () => {
    const light = apply(forkOfDark, sidesPatch(forkOfDark, 'light'));
    expect(sidesOf(light)).toBe('light');
    const dark = apply(light, sidesPatch(light, 'dark'));
    expect(dark).toEqual({ themeName: 'dark', polarity: 'dark', lightnessFloor: '20%', lightnessCeiling: '121%' });
  });

  it('gives a theme a second side, starting from its turn', () => {
    const both = apply(forkOfDark, sidesPatch(forkOfDark, 'both'));
    expect(sidesOf(both)).toBe('both');
    expect(both.light).toEqual({ polarity: 'light', lightnessFloor: '0%', lightnessCeiling: '100%' });
  });

  it('keeps the base when going back to the base’s side, and folds the other in when not', () => {
    const both: ThemeOverrides = { themeName: 'dark', accentHue: 160, light: { polarity: 'light', accentHue: 200 } };
    expect(apply(both, sidesPatch(both, 'dark'))).toEqual({ themeName: 'dark', accentHue: 160 });
    expect(apply(both, sidesPatch(both, 'light'))).toEqual({ themeName: 'dark', accentHue: 200, polarity: 'light' });
  });

  it('does nothing when the theme already is what was chosen', () => {
    expect(sidesPatch(forkOfDark, 'dark')).toBeUndefined();
  });
});

describe('an edit on one side', () => {
  const both: ThemeOverrides = {
    themeName: 'dark',
    accentHue: 160,
    roles: { accent: '#0f0' },
    light: { polarity: 'light', lightnessFloor: '0%' },
  };

  it('goes to the base when the base side is being edited, reaching both sides', () => {
    const next = apply(both, writePatch(both, null, { accentHue: 200 }));
    expect(withThemeSide(next, 'light').accentHue).toBe(200);
    expect(withThemeSide(next, 'dark').accentHue).toBe(200);
  });

  it('goes to the side block when the other side is being edited, leaving the base alone', () => {
    const next = apply(both, writePatch(both, 'light', { accentHue: 200 }));
    expect(next.accentHue).toBe(160);
    expect(withThemeSide(next, 'light').accentHue).toBe(200);
  });

  it('keeps only what differs from the base, so the base still reaches the side', () => {
    const next = apply(both, writePatch(both, 'light', { accentHue: 160, roles: { accent: '#0f0', page: '#fff' } }));
    expect(next.light).toEqual({ polarity: 'light', lightnessFloor: '0%', roles: { page: '#fff' } });
  });

  it('falls back to the base when a side’s own value is cleared', () => {
    const next = apply(both, writePatch(both, 'light', { lightnessFloor: undefined }));
    expect(next.light).toEqual({ polarity: 'light' });
  });
});
