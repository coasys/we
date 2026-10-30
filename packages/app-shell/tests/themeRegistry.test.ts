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
import { SHOWCASE_THEME_PRESETS, THEME_PRESETS } from '@we/themes/presets';
import { describe, expect, it } from 'vitest';

import { seedBundleThemes } from '../src/shared/registries/seedBundles';
import { themeRegistry } from '../src/shared/registries/themeRegistry';

/*
  These tests run as a build with developer features (app-shell's vitest config), so the registry
  holds the showcase pair as well. That a production build leaves them out is
  `devOnlyTemplates.test.ts`'s to prove, by building one. The themes a bundle the seed builds in
  brings sit beside them, and are the bundle's to check.
*/
const PRESETS = { ...THEME_PRESETS, ...SHOWCASE_THEME_PRESETS };
const builtIns = Object.fromEntries(Object.entries(themeRegistry).filter(([id]) => !(id in seedBundleThemes)));

describe('themeRegistry', () => {
  it('carries every preset the design system defines, and the showcase pair with developer features', () => {
    expect(Object.keys(builtIns).sort()).toEqual(Object.keys(PRESETS).sort());
  });

  it('takes each theme’s parameters from the preset rather than restating them', () => {
    for (const [id, entry] of Object.entries(builtIns)) {
      expect(entry.overrides, id).toBe(PRESETS[id as keyof typeof PRESETS].parameters);
      expect(entry.name, id).toBe(PRESETS[id as keyof typeof PRESETS].name);
    }
  });
});
