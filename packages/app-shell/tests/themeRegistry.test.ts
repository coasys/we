/**
 * Every built-in theme reaches the app.
 *
 * `themeRegistry` is hand-listed because each entry pairs a preset with its stylesheet, and a
 * stylesheet is a bundler concern (`?raw`) the design system has no business knowing about. The
 * cost of hand-listing is drift: a preset added to `@we/themes` and forgotten here exists as far as
 * the design system is concerned and is invisible in the picker, in `?theme=` links and to any
 * template naming it — with nothing failing anywhere.
 *
 * That is the same silent-omission failure the theme-selector guard exists for one layer down.
 */
import { THEME_PRESETS } from '@we/themes/presets';
import { describe, expect, it } from 'vitest';

import { themeRegistry } from '../src/shared/registries/themeRegistry';

describe('themeRegistry', () => {
  it('carries every preset the design system defines', () => {
    expect(Object.keys(themeRegistry).sort()).toEqual(Object.keys(THEME_PRESETS).sort());
  });

  it('takes each theme’s parameters from the preset rather than restating them', () => {
    for (const [id, entry] of Object.entries(themeRegistry)) {
      expect(entry.overrides, id).toBe(THEME_PRESETS[id as keyof typeof THEME_PRESETS].parameters);
      expect(entry.name, id).toBe(THEME_PRESETS[id as keyof typeof THEME_PRESETS].name);
    }
  });
});
