import { describe, expect, it } from 'vitest';

import { themeSides, withThemeSide } from './sides';

const theme = {
  polarity: 'dark' as const,
  accentHue: 160,
  lightnessFloor: '16%',
  roles: { page: 'oklch(18% 0.04 278)', accent: 'oklch(85% 0.12 160)' },
  light: { polarity: 'light' as const, lightnessFloor: '0%', roles: { page: 'oklch(98% 0.01 278)' } },
};

describe('the sides of a theme', () => {
  it('lists the sides a theme carries', () => {
    expect(themeSides(theme)).toEqual(['light']);
    expect(themeSides({ ...theme, dark: {} })).toEqual(['light', 'dark']);
    expect(themeSides({ accentHue: 1 })).toEqual([]);
  });

  it('lays the side worn over the base, merging role pins key by key', () => {
    expect(withThemeSide(theme, 'light')).toEqual({
      polarity: 'light',
      accentHue: 160,
      lightnessFloor: '0%',
      roles: { page: 'oklch(98% 0.01 278)', accent: 'oklch(85% 0.12 160)' },
    });
  });

  it('wears the base where the theme has no such side, and never passes the side blocks on', () => {
    const { light: _light, ...base } = theme;
    expect(withThemeSide(theme, 'dark')).toEqual(base);
    expect(withThemeSide(theme, undefined)).toEqual(base);
  });
});
