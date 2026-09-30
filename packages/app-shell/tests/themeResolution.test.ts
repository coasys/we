import { describe, expect, it } from 'vitest';

import { isValidThemeKey } from '../src/shared/registries/themeRegistry';

/**
 * Why a pinned custom theme flashed white on every other reload.
 *
 * Boot caches the *id* of the theme to wear so the first paint does not wait for AD4M. That is
 * enough for a built-in — the registry holds its parameters — and not enough for a custom theme,
 * where an id without its record means nothing. So there is a window on every load where the theme
 * being asked for cannot be answered, and the resolver had to invent something.
 *
 * These pin the two facts that made the invention so visible, both of which are easy to regress:
 * a custom id is *never* a valid registry key, and the fallback anything reaches for lands on the
 * light end of the scale.
 */
describe('theme id resolution during the load window', () => {
  it('never recognises a custom theme id, however it is spelled', () => {
    // Whatever a stored custom theme's id looks like, the registry cannot answer for it — which is
    // exactly why an id alone is not enough to restore one at boot.
    expect(isValidThemeKey('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')).toBe(false);
    expect(isValidThemeKey('my-personal-theme')).toBe(false);
    expect(isValidThemeKey('dark-fork-2')).toBe(false);
  });

  it('does recognise the built-ins, which is why they restore correctly', () => {
    for (const key of ['light', 'dark', 'black', 'retro', 'cyberpunk']) {
      expect(isValidThemeKey(key), `${key} should be a registry key`).toBe(true);
    }
  });

  /*
    The asymmetry above is the whole bug. `defaultThemeId` is cached to localStorage on every
    settings change, so for an agent whose default is a custom theme the cached id is one nothing
    can resolve — and any fallback chain that ends in `isValidThemeKey(cached) ? cached : 'light'`
    ends at `light`, for that agent, on every single load.
  */
  it('shows the fallback chain reaching light for an agent whose default is custom', () => {
    const cachedDefault = 'my-personal-theme';
    const fallback = isValidThemeKey(cachedDefault) ? cachedDefault : 'light';
    expect(fallback).toBe('light');
  });
});
