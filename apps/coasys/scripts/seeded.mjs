#!/usr/bin/env node
/**
 * Runs a command for the Coasys seed: `WE_SEED` is `seeds/coasys.seed.json` unless the caller set
 * another, and that seed's registries are generated before the command runs.
 *
 *   node scripts/seeded.mjs vite build
 *
 * This app is the Coasys app, so its default seed is Coasys's rather than WE's own. A seed other than
 * WE's has its own copies of the shell's generated registries under `packages/app-shell/.seed-build/`
 * (see `scripts/seed.cjs`), which the Vite plugin points the shell at; they are written here, from
 * the shell's own generators, so a build or a dev server never finds them missing or out of date.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';

process.env.WE_SEED ??= 'seeds/coasys.seed.json';

const seedFile = createRequire(import.meta.url)('../../../scripts/seed.cjs');
const shell = join(seedFile.REPO_ROOT, 'packages/app-shell');

/** The shell's generators, in the order its own `build:steps` runs them. */
const GENERATORS = [
  'generateTemplateRegistry.mjs',
  'generateViewRegistry.mjs',
  'generateModuleRegistry.mjs',
  'generateElementRegistry.mjs',
  'generateBundleRegistry.mjs',
];

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// WE's own seed uses the checked-in registries, which the shell's build already wrote.
if (!seedFile.isDefaultSeed()) {
  for (const generator of GENERATORS) run(process.execPath, [join('scripts', generator)], shell);
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('Usage: node scripts/seeded.mjs <command> [args…]');
  process.exit(2);
}
console.log(`[coasys] ${command} ${args.join(' ')} for ${seedFile.seedLabel()}`);
run(command, args, process.cwd());
