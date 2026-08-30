import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { componentCascadeFor } from './shared/helpers';

/**
 * Primitives paint meanings with roles, and shapes through their cascade.
 *
 * The sibling of `4-components/src/themeReach.test.ts`, and for the same reason: `role-audit` walks
 * composed schema trees, so it structurally cannot see a Lit component's CSS — and the components
 * every template is built from were the one place nothing was checking. It found real things:
 * a blockquote at `neutral-600` where `text-muted` exists, status markers at `success-500` where
 * `success-text` does, a progress bar's whole variant map, an alert's four borders, and a form
 * field's error colour and danger ring.
 *
 * A scale position is not frozen — it follows the theme's hue, saturation and polarity — but it
 * cannot follow what a theme *pins*, and the contrast corrections at apply time skip it entirely.
 * That is the difference the roles exist for.
 */

const SRC = join(__dirname, 'primitives');

/**
 * Where a scale position is the right answer, with the reason.
 *
 * A palette is a set of colours standing for *categories* rather than meanings, where a theme
 * pinning `dangerText` means "my error messages" and not "every item in this legend". Empty is the
 * honest state today: every scale position in the primitives turned out to be a meaning.
 */
const PALETTES: { file: string; why: string }[] = [];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.ts$/.test(entry) || entry.includes('.test.')) return [];
    return [path];
  });
}

/** Declarations only — these files argue about the very colours being asserted on. */
const declarations = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');

describe('no primitive paints a meaning with a scale position', () => {
  const allowed = new Set(PALETTES.map((p) => p.file));

  const offenders = sourceFiles(SRC)
    .filter((file) => !allowed.has(file.slice(SRC.length + 1)))
    .flatMap((file) =>
      declarations(readFileSync(file, 'utf8'))
        .split('\n')
        .map((line, i) => ({ file: file.slice(SRC.length + 1), line: i + 1, text: line.trim() }))
        .filter(({ text }) => /var\(--we-color-(neutral|primary|success|warning|danger)-\d/.test(text)),
    );

  it('so a theme can pin it and the contrast layer can measure it', () => {
    // Reach for a role from the table in `1-tokens/src/role.ts`. If the colour is genuinely a
    // category rather than a meaning, add the file to PALETTES above with the reason.
    expect(offenders).toEqual([]);
  });
});

describe('no primitive hand-writes a cascade it is registered for', () => {
  /*
    A primitive gets radius, padding and gap from COMPONENT_CASCADE without naming anything. Writing
    the chain out instead is how `Select` ended up carrying a four-deep copy of `we-button`'s radius
    cascade that nothing would have updated.

    The per-component override slot (`--we-theme-{own name}-{axis}`) is exempt: reading your own
    override is the mechanism, not a bypass of it.
  */
  const offenders = sourceFiles(SRC).flatMap((file) => {
    const own = file.slice(SRC.length + 1).replace(/\.ts$/, '');
    const cascade = componentCascadeFor(own);
    return declarations(readFileSync(file, 'utf8'))
      .split('\n')
      .map((line, i) => ({ file: `${own}.ts`, line: i + 1, text: line.trim() }))
      .filter(({ text }) => {
        const match = /--we-theme-[a-z-]+-(radius|padding-x|padding|gap)\b/.exec(text);
        if (!match) return false;
        const [full, axis] = match;
        // Its own per-component override slot: reading that IS the mechanism.
        if (full === `--we-theme-${own}-${axis}`) return false;
        /*
          Its own registered group. A `nativePadding` component emits no padding from the generated
          sheet and so has to restate its group in CSS — `we-button` and `we-badge` both do, and that
          is the cascade working rather than a bypass of it. Anything reading a group it is NOT
          registered for is the hazard: that is a copy of somebody else's chain.
        */
        const registered =
          axis === 'radius' ? cascade?.radiusGroup : axis === 'gap' ? cascade?.gapGroup : cascade?.paddingGroup;
        return full !== registered;
      });
  });

  it('so a change to one component’s chain cannot leave a copy of it stale', () => {
    expect(offenders).toEqual([]);
  });
});
