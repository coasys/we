/**
 * Writes the bundles a deployment builds in, from the seed's `bundles` list.
 *
 * Each id names a file under `bundles/` at the repository root (`<id>.bundle.json`). Its contents are
 * written into the generated module as data rather than imported, so the bundler and TypeScript need
 * nothing special to read a JSON file from outside the package — and an unlisted bundle never reaches
 * the build, as an unlisted template does not.
 *
 * Only the envelope is checked here — that the file is a bundle of the format this build reads, and
 * that its id is the one the seed named. Whether its templates draw and its record types validate is
 * `bundles.test.ts`'s, and the app's, to say.
 *
 * Run: `pnpm --filter @we/app-shell generate-bundles`
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const outPath = resolve(here, '../src/shared/registries/seedBundles.generated.ts');

const seed = JSON.parse(await readFile(resolve(repoRoot, 'we-seed.json'), 'utf8'));
const ids = seed.bundles ?? [];

const bundles = [];
for (const id of ids) {
  const file = resolve(repoRoot, 'bundles', `${id}.bundle.json`);
  let bundle;
  try {
    bundle = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    console.error(`we-seed.json names the bundle "${id}", and ${file} could not be read: ${error.message}`);
    process.exit(1);
  }
  if (bundle.format !== 'we-bundle' || bundle.formatVersion !== 1) {
    console.error(`bundles/${id}.bundle.json is not a bundle of format we-bundle 1`);
    process.exit(1);
  }
  if (bundle.id !== id) {
    console.error(`bundles/${id}.bundle.json says its id is "${bundle.id}"; the file name and the id must agree`);
    process.exit(1);
  }
  bundles.push(bundle);
}

const output = `/**
 * The bundles this deployment builds in.
 *
 * GENERATED FILE — do not edit. Rewritten by \`pnpm --filter @we/app-shell generate-bundles\` from
 * \`we-seed.json\`'s \`bundles\` list and the files under \`bundles/\`. Change those and regenerate.
 */
import type { Bundle } from '@we/schema-shared';

export const seedBundles: Bundle[] = ${JSON.stringify(bundles)} as unknown as Bundle[];
`;

const prettierConfig = await resolveConfig(outPath);
await writeFile(outPath, await format(output, { ...prettierConfig, filepath: outPath }), 'utf8');
console.log(`seedBundles.generated.ts — ${bundles.length} bundle(s)${bundles.length ? `: ${ids.join(', ')}` : ''}`);
