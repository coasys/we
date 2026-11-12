/**
 * The window's look, worked out at build time (`vite.js`): the theme the app's screens before a
 * session wear, by the rule the app wears it by, and a stylesheet that draws only from it.
 */
import { describe, expect, it } from 'vitest';

import { identityBrand, identityThemeCss } from '../vite.js';
import css from './identity.css?raw';

/** A theme as an app's bundle brings one: one look, dark, its own page and accent, its own typeface. */
const ONE_LOOK = {
  overrides: {
    schemaVersion: 7,
    polarity: 'dark',
    accentHue: 156,
    accentSaturation: 63,
    accentLightness: 88,
    roles: { page: '#131533', surface: '#1b1e45', onAccent: '#0f1230' },
    controlRadius: '999px',
    fontFamily: "'Test Grotesque', system-ui, sans-serif",
    fontFaces: [{ family: 'Test Grotesque', src: 'data:font/woff2;base64,d09GMgAB', weight: '300 800' }],
  },
};

/** The `:root` block that applies with none of the computer's settings on. */
const defaults = (sheet: string) => /(?:^|\n):root \{\n([^}]*)\n\}/.exec(sheet)?.[1] ?? '';
/** Each `@media` block, by its query. */
const blocks = (sheet: string) =>
  Object.fromEntries([...sheet.matchAll(/@media ([^{]+) \{\n:root \{\n([^}]*)\n\}\n\}/g)].map((m) => [m[1], m[2]]));

describe('identityThemeCss', () => {
  it("carries the app's own page and accent, not WE's", () => {
    const sheet = identityThemeCss(ONE_LOOK);
    expect(defaults(sheet)).toContain('--we-role-page: #131533;');
    expect(defaults(sheet)).toContain('--we-role-on-accent: #0f1230;');
    expect(defaults(sheet)).toContain('--we-accent-lightness: 88;');
    expect(defaults(sheet)).toMatch(/--we-color-accent-hue: 156;/);
    expect(defaults(sheet)).toContain('--we-theme-control-radius: 999px;');
    expect(defaults(sheet)).toContain("--we-font-family: 'Test Grotesque'");
    expect(identityThemeCss()).not.toContain('#131533');
  });

  it('wears a theme of one look in either colour scheme, as the app does', () => {
    const sheet = identityThemeCss(ONE_LOOK);
    for (const [query, vars] of Object.entries(blocks(sheet)))
      if (!/contrast/.test(query)) expect(vars, query).not.toMatch(/--we-role-/);
    expect(defaults(sheet)).toContain('color-scheme: dark;');
  });

  it("follows the computer's colour scheme for a theme with a light and a dark side", () => {
    const sides = { overrides: { roles: { page: '#f4f4ff' }, dark: { polarity: 'dark', roles: { page: '#131533' } } } };
    const sheet = identityThemeCss(sides);
    expect(defaults(sheet)).toContain('--we-role-page: #f4f4ff;');
    expect(blocks(sheet)['(prefers-color-scheme: dark)']).toContain('--we-role-page: #131533;');
    // WE's own presets, where the app brings no theme: the ramps turn over in the dark.
    expect(blocks(identityThemeCss())['(prefers-color-scheme: dark)']).toContain('--we-color-ramp-direction: -1;');
  });

  it('follows more contrast and reduced motion, and leaves the tokens alone where they do not apply', () => {
    const sheet = identityThemeCss(ONE_LOOK);
    const all = blocks(sheet);
    expect(all['(prefers-reduced-motion: reduce)']).toContain('--we-transition-200: 0ms;');
    expect(all['(prefers-contrast: more)']).toContain('--we-theme-focus-ring-width: 3px;');
    // The token's own transition stands wherever motion is not reduced.
    for (const [query, vars] of Object.entries(all))
      if (!/reduced-motion/.test(query)) expect(vars, query).not.toMatch(/--we-transition-/);
    // The block for every setting at once comes last and says everything a narrower one changed.
    const widest = Object.keys(all).at(-1)!;
    expect(widest.split(' and ')).toHaveLength(3);
    for (const vars of Object.values(all))
      for (const name of vars.matchAll(/(--[\w-]+):/g)) expect(all[widest]).toContain(`${name[1]}:`);
  });

  it("serves the theme's typeface from where the build put it, and drops a face that is not one", () => {
    const sheet = identityThemeCss(ONE_LOOK, () => './Test-Grotesque.woff2');
    expect(sheet).toMatch(
      /@font-face \{\n {2}font-family: 'Test Grotesque';\n {2}src: url\(\.\/Test-Grotesque\.woff2\);\n {2}font-display: swap;\n {2}font-weight: 300 800;\n\}/,
    );
    const remote = { overrides: { fontFaces: [{ family: 'Far', src: 'https://fonts.example/far.woff2' }] } };
    expect(identityThemeCss(remote)).not.toContain('@font-face');
  });
});

describe('identityBrand', () => {
  it("is the app's name, and its mark as an image", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const brand = identityBrand({ name: 'Test app', mark: svg });
    expect(brand?.name).toBe('Test app');
    expect(brand?.mark).toBe(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
    expect(identityBrand({ name: 'Test app' })?.mark).toBeNull();
  });

  it('is none for an app with no brand, so the window names no app', () => {
    expect(identityBrand(undefined)).toBeNull();
  });
});

describe('the stylesheet', () => {
  it("draws every colour from the theme's variables", () => {
    // The QR code alone is light on any theme: a camera reads it dark on light.
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\.qr \{[^}]*\}/, '');
    expect(rules).not.toMatch(/#[\da-f]{3,8}\b|\b(rgb|hsl|oklch|oklab)a?\(|\b(white|black)\b/i);
    expect(rules).not.toMatch(/--we-font-family-(base|mono)/);
  });
});
