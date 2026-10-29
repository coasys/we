/*
  Prints what a built bundle exports, for the release beside it: every toolset's `appliesTo` and
  its tools as the bundle declares them, the package version, and the WE commit it was built from.

  A host that compiles the bundle in reads its tool list from this file rather than starting the
  bundle to ask, so it is written from the bundle itself and never by hand.

  Usage: node packages/agent-tools/scripts/release-manifest.mjs <bundle> <commit>
*/
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [bundle, commit] = process.argv.slice(2);
if (!bundle || !/^[0-9a-f]{40}$/.test(commit ?? '')) {
  console.error('usage: release-manifest.mjs <bundle> <full commit sha>');
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const { toolsets } = await import(pathToFileURL(resolve(bundle)).href);

const manifest = {
  package: '@we/agent-tools',
  version,
  commit,
  toolsets: Object.fromEntries(
    Object.entries(toolsets).map(([name, { appliesTo, tools }]) => [name, { appliesTo, tools }]),
  ),
};
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
