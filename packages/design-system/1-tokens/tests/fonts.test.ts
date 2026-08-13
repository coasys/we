/**
 * The webfaces are carried, not fetched.
 *
 * `--we-font-family-base` is DM Sans, so this is not a privacy nicety with a typographic side
 * effect — it is what decides whether a launch with no network renders the interface in the app's
 * typeface or in the system fallback. For a local-first desktop app, "no network" is an ordinary
 * Tuesday rather than an edge case.
 *
 * Asserted against the built output rather than the generator's source, because what ships is the
 * file, and the failure mode being guarded against is an `@import` reappearing in it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const CSS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../dist/css');
const built = existsSync(join(CSS_DIR, 'fonts.css'));

// The generator writes these; a clean checkout has not run it yet. Skipping is honest — a suite
// that silently passed on a missing file would assert nothing at all.
describe.skipIf(!built)('the built fonts.css', () => {
  const css = built ? readFileSync(join(CSS_DIR, 'fonts.css'), 'utf8') : '';

  it('fetches nothing over the network', () => {
    expect(css).not.toMatch(/@import/);
    expect(css).not.toMatch(/https?:/);
  });

  it('declares the three families the tokens name', () => {
    for (const family of ['DM Sans', 'Mozilla Text', 'Boldonse']) {
      expect(css).toContain(`font-family: '${family}'`);
    }
  });

  it('keeps unicode-range, so the browser still picks a subset per character', () => {
    // Dropping it would make the first matching face win for every character, so an accented name
    // would render from whichever subset happened to be declared first.
    expect(css.match(/unicode-range:/g) ?? []).toHaveLength(6);
  });

  it('points at files that are actually there', () => {
    const referenced = [...css.matchAll(/url\('\.\/fonts\/([^']+)'\)/g)].map((m) => m[1]);
    expect(referenced.length).toBe(6);

    const present = new Set(readdirSync(join(CSS_DIR, 'fonts')));
    for (const file of referenced) expect(present.has(file)).toBe(true);
  });
});

describe.skipIf(!built)('the main token entry', () => {
  it('still makes no network request either', () => {
    // The property the generator's own comment has always claimed: token variables work offline.
    const index = readFileSync(join(CSS_DIR, 'index.css'), 'utf8');
    expect(index).not.toMatch(/https?:/);
  });
});
