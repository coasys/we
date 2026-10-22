/**
 * Which seed this build is for, and where what it generates goes.
 *
 * A seed describes a deployment. `we-seed.json` at the repository root is WE's own and the default;
 * any other lives under `seeds/` and is chosen with `WE_SEED`:
 *
 *   WE_SEED=seeds/coasys.seed.json pnpm build
 *
 * Every script and config that reads a seed reads it through here, so they cannot disagree about
 * which one is in use.
 *
 * ## Why another seed's generated files go somewhere else
 *
 * Several registries are generated from the seed and checked in (`*.generated.ts` in the shell), and
 * CI fails a build that leaves them changed. They are WE's own seed's. A build for another seed
 * writes its versions into a `.seed-build/<name>/` directory beside the package that generates them
 * (ignored by git; beside the package so the bare package imports inside them still resolve), and
 * the apps' Vite plugin (`scripts/seed-vite.mjs`) points the shell at them. Building a second
 * deployment never leaves the working tree dirty, or one deployment's lists committed as another's.
 *
 * CommonJS, so the `.cjs` scripts can `require` it and the ESM ones and the Vite configs can import it.
 */
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_SEED = 'we-seed.json';

/** The seed file this run is for, as an absolute path. */
function seedPath() {
  const chosen = process.env.WE_SEED;
  if (!chosen) return path.join(REPO_ROOT, DEFAULT_SEED);
  return path.isAbsolute(chosen) ? chosen : path.resolve(REPO_ROOT, chosen);
}

/** Whether this run is for WE's own seed, whose generated files are the checked-in ones. */
function isDefaultSeed() {
  return seedPath() === path.join(REPO_ROOT, DEFAULT_SEED);
}

/** A short name for the seed: `we` for the default, else the file's name without `.seed.json`. */
function seedName() {
  if (isDefaultSeed()) return 'we';
  return path.basename(seedPath()).replace(/\.seed\.json$|\.json$/, '');
}

/** The seed, parsed. Throws with the path in the message when it cannot be read. */
function readSeed() {
  const file = seedPath();
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`The seed ${path.relative(REPO_ROOT, file)} could not be read: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`The seed ${path.relative(REPO_ROOT, file)} is not valid JSON: ${error.message}`);
  }
}

/**
 * This seed's generated directory inside `packageDir` — `<packageDir>/.seed-build/<name>` — or null
 * for WE's own seed, whose generated files are the checked-in ones.
 */
function generatedDir(packageDir) {
  if (isDefaultSeed()) return null;
  return path.join(packageDir, '.seed-build', seedName());
}

/**
 * Where a generated file belongs for this seed: `checkedIn` itself for WE's own seed, otherwise the
 * same file name in `generatedDir(packageDir)`, with the directory made.
 */
function generatedPath(checkedIn, packageDir) {
  const dir = generatedDir(packageDir);
  if (!dir) return checkedIn;
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, path.basename(checkedIn));
}

/**
 * What a desktop build is called and installed as, with WE's own values where the seed is silent.
 * `appId` is the product part; each host appends its runtime (`.electron`, `.tauri`).
 */
function desktopOf(seed) {
  const desktop = seed.desktop ?? {};
  return {
    productName: desktop.productName ?? 'WE',
    appId: desktop.appId ?? 'io.weco.we',
    icon: desktop.icon ? path.resolve(REPO_ROOT, desktop.icon) : null,
  };
}

/** How a message names the seed: its path from the repository root. */
function seedLabel() {
  return path.relative(REPO_ROOT, seedPath());
}

module.exports = {
  REPO_ROOT,
  DEFAULT_SEED,
  seedPath,
  isDefaultSeed,
  seedName,
  readSeed,
  generatedPath,
  generatedDir,
  desktopOf,
  seedLabel,
};
