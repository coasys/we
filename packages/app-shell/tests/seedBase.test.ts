/**
 * `seedBase` (scripts/seed-vite.mjs) answers what `deploymentBase` does, from the bundles' files.
 *
 * The identity windows are built with `seedBase` and never run the shell, so this is what keeps the
 * page that shows the 12 words in the theme, name and mark of the app's screens before a session: if
 * the shell's rule for choosing the base changes and the build's does not, this fails.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { svgDataUrl } from '@shared/bundles/brand';
import { bundlePieces } from '@shared/bundles/bundlePieces';
import { readBundle } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

// Plain ESM shared by every app's Vite config, the identity windows' included.
import { seedBase } from '../../../scripts/seed-vite.mjs';
import { deploymentBase } from '../src/frameworks/solid/base/BaseApp';
import type { WeSeedFile } from '../src/types/seed';

const ROOT = resolve(import.meta.dirname, '../../..');
const read = (path: string) => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));
const pieces = (seed: WeSeedFile) =>
  (seed.bundles ?? []).map((id) => bundlePieces(readBundle(read(`bundles/${id}.bundle.json`)).bundle!));

const SEEDS: [string, WeSeedFile][] = [
  ['we-seed.json', read('we-seed.json')],
  ['seeds/coasys.seed.json', read('seeds/coasys.seed.json')],
  ['a seed naming another app', { ...read('seeds/coasys.seed.json'), host: { ui: { app: 'elsewhere' } } }],
  ['a seed with no bundles', { ...read('we-seed.json'), bundles: [] }],
];

describe('seedBase', () => {
  it.each(SEEDS)("is %s's base as the shell chooses it: its first theme, its name and mark", (_, seed) => {
    const shell = deploymentBase(seed, pieces(seed));
    const build = seedBase(seed);
    if (!shell) return expect(build).toEqual({});
    expect(build.theme?.overrides).toEqual(shell.theme?.overrides);
    expect(build.brand?.name).toBe(shell.brand.name);
    expect(svgDataUrl(build.brand?.mark)).toBe(shell.brand.mark);
  });

  it("finds the Coasys app's base in the seed it ships with", () => {
    const build = seedBase(read('seeds/coasys.seed.json'));
    expect(build.brand?.name).toBe('Coasys');
    expect(build.theme).toBeDefined();
  });
});
