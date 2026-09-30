import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Layer-4 components reach the theme through the mechanisms, not around them.
 *
 * Every problem this file guards against was found by reading rather than by running, which is the
 * whole reason it exists. The mechanisms were fine — `COMPONENT_CASCADE` for primitives, family
 * names and `family:` registration for layer 4 — and things kept ending up outside them, silently,
 * because a hand-written `var()` chain works right up until the thing it was copied from changes.
 *
 * `Select` is the case worth remembering: it carried a four-deep copy of `we-button`'s radius
 * cascade, and when the modal's padding chain gained a link nothing would have told anyone that copy
 * was stale.
 */

const SRC = join(__dirname, 'components');

/** Axes a family covers. A raw reference to one of these is a mechanism being bypassed. */
const FAMILY_AXES = /--we-theme-[a-z-]*-(radius|padding|gap)\b/;

/**
 * Theme variables with no family, which therefore have to be named directly.
 *
 * Each is a theme axis that carries no group — a single knob rather than a per-kind decision — so
 * there is no name to use instead. Listed rather than pattern-matched so adding one is a decision.
 */
const NO_FAMILY = new Set([
  '--we-theme-shadow',
  '--we-theme-surface-opacity',
  '--we-theme-surface-blur',
  '--we-theme-state-duration',
  '--we-theme-switch-duration',
  '--we-theme-disabled-opacity',
  '--we-theme-control-height-offset',
  '--we-theme-avatar-radius',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(entry) || entry.includes('.test.')) return [];
    return [path];
  });
}

/** Declarations only — several of these files discuss the very variables being asserted about. */
const declarations = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

describe('no layer-4 component hand-writes a family chain', () => {
  const offenders = sourceFiles(SRC).flatMap((file) => {
    const lines = declarations(readFileSync(file, 'utf8')).split('\n');
    return lines
      .map((line, i) => ({ file: file.slice(SRC.length + 1), line: i + 1, text: line.trim() }))
      .filter(({ text }) => {
        const match = /--we-theme-[a-z-]+/.exec(text);
        if (!match || NO_FAMILY.has(match[0])) return false;
        return FAMILY_AXES.test(text);
      });
  });

  it('so radius, padding and gap always come from a name or from `family:`', () => {
    // Use `family: 'surface'` on the component, or a family name on the prop (`r: 'surface'`).
    // themeFamily.ts lists what exists and why the matrix is sparse.
    expect(offenders).toEqual([]);
  });
});

describe('no layer-4 component paints a meaning with a scale position', () => {
  /*
    A scale position is for a palette — a chart series, a waveform, a syntax highlighter — where the
    colour is a category rather than a meaning. Everywhere else it is a role, because the contrast
    corrections at apply time measure a role against what is behind it and skip a scale position
    entirely. This is the check `role-audit` makes over templates; it walks composed schema trees, so
    it structurally cannot see component source, and the components every template is built from were
    the one place nothing was looking.
  */
  const PALETTES = [
    // Syntax highlighting: a theme pinning `dangerText` means "my error messages", not "every
    // string literal in every code block".
    'CodeEditor',
    // A waveform's bars are a category, not a status.
    'AudioVisualiser',
  ];

  const offenders = sourceFiles(SRC)
    .filter((file) => !PALETTES.some((name) => file.includes(name)))
    .flatMap((file) => {
      const lines = declarations(readFileSync(file, 'utf8')).split('\n');
      return lines
        .map((line, i) => ({ file: file.slice(SRC.length + 1), line: i + 1, text: line.trim() }))
        .filter(({ text }) => /var\(--we-color-(neutral|primary|success|warning|danger)-\d/.test(text));
    });

  it('so a theme can restyle them and the contrast layer can measure them', () => {
    expect(offenders).toEqual([]);
  });
});
