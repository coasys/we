/**
 * The sections a space is made of, and the registration step that fails silently.
 *
 * 7,584 lines of view schemas with no `test` script at all — the largest package in the repo
 * without one. Schema validity is covered by `pnpm validate:schemas`, which is a real gate; what
 * nothing covered is the *registration*, which `docs/contributing/surfaces.md` names as the step
 * whose omission is invisible: a view that is written but not in the generator's catalogue is
 * correct code that never appears anywhere, with nothing failing.
 *
 * So these are about identity and wiring rather than about what any view renders.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BUILT_IN_VIEWS } from './index.ts';

const ids = Object.keys(BUILT_IN_VIEWS);

describe('the built-in views', () => {
  it('finds some, so nothing below is vacuous', () => {
    expect(ids.length).toBeGreaterThan(4);
  });

  it.each(ids)('%s declares itself a view', (id) => {
    /*
      `meta.role` is what tells a section from a shell, and absent means shell — so a view that
      forgets it is installed as a whole interface. The host would then expand `{ path: '$views' }`
      inside something that is not a section, which reads as a space rendering a space.
    */
    expect(BUILT_IN_VIEWS[id].meta?.role).toBe('view');
  });

  it.each(ids)('%s is named and described', (id) => {
    // The name is what a member reads in the section list and in the space's own settings; a view
    // with none is a row somebody has to guess at.
    const meta = BUILT_IN_VIEWS[id].meta;
    expect(meta?.name?.trim()).toBeTruthy();
    expect(meta?.description?.trim()).toBeTruthy();
    expect(meta?.icon?.trim()).toBeTruthy();
  });

  it('is exactly what the generator will offer a deployment', () => {
    /*
      `generateViewRegistry.mjs` holds its own `CATALOGUE` of id → export, and a seed may only name
      an id that is in it. The two lists are the same fact written twice, and the failure is
      asymmetric and silent in both directions: a view missing from the catalogue can never be put
      in a seed, and a catalogue entry with no export here fails the *generator* at build time with
      an import error rather than here with a sentence.

      Read from the script's source, because it is a build script rather than a module this package
      can import.
    */
    const script = readFileSync(
      fileURLToPath(new URL('../../../app-shell/scripts/generateViewRegistry.mjs', import.meta.url)),
      'utf8',
    );
    const block = /const CATALOGUE = \{([\s\S]*?)\n\};/.exec(script);
    expect(block, 'could not find CATALOGUE in generateViewRegistry.mjs').toBeTruthy();

    const catalogued = [...block![1].matchAll(/^\s*([A-Za-z0-9_-]+):/gm)].map((m) => m[1]);
    expect([...catalogued].sort()).toEqual([...ids].sort());
  });
});
