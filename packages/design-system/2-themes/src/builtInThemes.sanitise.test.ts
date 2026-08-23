/**
 * WE's own themes, run through the filter WE applies to everybody else's.
 *
 * Built-in themes are injected through the same choke point as an installed one — deliberately, so
 * that "what a theme may do" is one rule rather than a rule and an exemption. That only stays true
 * if the built-ins keep obeying it, and the failure mode is quiet: a dropped rule shows up as a
 * theme that looks slightly wrong, months later, with nothing pointing at the cause.
 *
 * This is the test that caught the retro theme's Google Fonts `@import` — which had been fetching a
 * typeface the theme never used, announcing every retro user to a third party for nothing.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { ThemeRole } from './overrides';
import { THEME_PRESETS, type ThemeName } from './presets';
import { sanitiseCss } from './sanitiseCss';
import { roleVar } from './themeStyles';

const SRC = dirname(fileURLToPath(import.meta.url));

const themes = readdirSync(SRC, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({ name: entry.name, css: readFileSync(join(SRC, entry.name, 'index.css'), 'utf8') }));

/**
 * jsdom's CSS parser does not recognise the `src` descriptor, so it drops it and every `@font-face`
 * with it. Nothing this code can do about that, and nothing to learn from asserting it — a real
 * CSSOM keeps a data-URI font. Excluded here rather than fudged in the sanitiser, which behaves
 * correctly in the environment it actually runs in.
 */
const JSDOM_ARTEFACT = /@font-face \(its font source could not be read\)/;

describe('the built-in themes', () => {
  it('finds them all', () => {
    // A guard on the guard: an empty glob would make every assertion below vacuously pass.
    expect(themes.map((t) => t.name).sort()).toEqual(['black', 'cyberpunk', 'dark', 'light', 'retro']);
  });

  it.each(themes)('$name survives the sanitiser with nothing removed', ({ css }) => {
    const { removed } = sanitiseCss(css);
    expect(removed.filter((entry) => !JSDOM_ARTEFACT.test(entry))).toEqual([]);
  });

  it.each(themes)('$name keeps its rules when confined to a scope', ({ css }) => {
    // Scoping is where a theme written against `:root` or `html` would quietly lose everything.
    const unscoped = sanitiseCss(css);
    const scoped = sanitiseCss(css, { scope: '[data-we-theme-scope]', namespace: 'n' });

    const count = (out: string) => (out.match(/\{/g) ?? []).length;
    expect(count(scoped.css)).toBeGreaterThanOrEqual(count(unscoped.css));
  });

  /*
    A theme's CSS file and its preset parameters must agree about roles.

    `themeParametersToStyle` re-declares every role's parametric default so an unpinned role resolves against
    the theme it belongs to rather than against :root (see ROLE_DEFAULT_VARS). Those land as inline
    styles, which outrank an attribute-selector rule — so a role a theme declares *only* in its CSS
    file would be overwritten by its own default, and the theme would lose the relationship it was
    written to express. Dark is the live case: it declares --we-role-surface-raised in CSS and
    mirrors it in `presets.ts`, which is what keeps it working. Nothing enforced that mirroring.
  */
  it('declares no role in CSS that its preset parameters do not also pin', () => {
    for (const { name, css } of themes) {
      const declared = [...css.matchAll(/(--we-role-[a-z-]+)\s*:/g)].map((m) => m[1]);
      if (!declared.length) continue;

      const params = THEME_PRESETS[name as ThemeName].parameters as { roles?: Record<string, string> };
      const pinned = Object.keys(params.roles ?? {}).map((role) => roleVar(role as ThemeRole));
      expect({ theme: name, declared: declared.filter((v) => !pinned.includes(v)) }).toEqual({
        theme: name,
        declared: [],
      });
    }
  });

  it('carries its fonts rather than fetching them', () => {
    // The rule the retro theme broke. Stated on the raw source, because the sanitiser would drop an
    // `@import` silently and this should fail loudly at the file that has one.
    for (const { name, css } of themes) {
      expect(`${name}: ${css}`).not.toMatch(/@import\s+(url\()?['"]?https?:/i);
    }
  });
});
