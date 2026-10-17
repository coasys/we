/**
 * Write each cartridge as a bundle file, under `bundles/` at the repository root.
 *
 *   pnpm --filter @we/template-cartridges bundle
 *
 * The files are checked in: they are what a deployment names in its seed (`bundles`) and what
 * somebody installs from a file to try the install flow. `cartridges.test.ts` fails when one has
 * drifted from its cartridge, so a change here is made by running this, not by hand.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { format, resolveConfig } from 'prettier';

import { bundleFileName, cartridgeBundles } from '../src/bundles.ts';

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) void main();

async function main(): Promise<void> {
  const dir = resolve(import.meta.dirname, '../../../../bundles');
  mkdirSync(dir, { recursive: true });
  for (const bundle of cartridgeBundles()) {
    const file = resolve(dir, bundleFileName(bundle.id));
    // In the repository's own style, so the format check passes on what this writes.
    const options = (await resolveConfig(file)) ?? {};
    writeFileSync(file, await format(JSON.stringify(bundle), { ...options, filepath: file }));
    console.log(`wrote ${file}`);
  }
}
