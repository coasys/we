#!/usr/bin/env node
/**
 * pnpm bump:ad4m [version | npm tag] [--no-install] [--allow-older]
 *
 * Moves WE's pin of @coasys/ad4m and @coasys/ad4m-connect to one published version: the root
 * `pnpm.overrides` (which decide what installs) and every exact version a workspace package
 * declares (which should say the same). Defaults to whatever npm's `dev` tag points at.
 *
 * Refuses a version that is not published for both packages. The app's client comes from the SDK
 * copy bundled inside ad4m-connect, so a core from one ad4m commit and a connect from another is a
 * pairing nobody tested; it has happened, and this is what stops it happening again.
 *
 * Refuses, too, a version whose commit is behind the current pin's, unless given --allow-older: a
 * tag can lag (npm's `dev` tag did, for weeks), and following it would quietly undo ad4m changes.
 *
 * Prints the ad4m commits between the old pin and the new one, for the bump PR's description.
 * Bump in a PR of its own, and run `pnpm verify:ad4m` before merging it
 * (docs/contributing/ad4m-and-deploys.md).
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = ['@coasys/ad4m', '@coasys/ad4m-connect'];
const REGISTRY = 'https://registry.npmjs.org';

const args = process.argv.slice(2);
const install = !args.includes('--no-install');
const allowOlder = args.includes('--allow-older');
const wanted = args.find((a) => !a.startsWith('--')) ?? 'dev';

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

async function getJson(url) {
  const response = await fetch(url);
  if (response.status === 404) return null;
  if (!response.ok) fail(`${url} answered ${response.status}.`);
  return response.json();
}

/** The version a tag points at, or the argument itself when it is already a version. */
async function resolveVersion(spec) {
  const tags = await getJson(`${REGISTRY}/-/package/${encodeURIComponent(PACKAGES[0])}/dist-tags`);
  return tags?.[spec] ?? spec;
}

/** The published manifest of one version, or null when it was never published. */
function manifest(name, version) {
  return getJson(`${REGISTRY}/${name.replace('/', '%2f')}/${encodeURIComponent(version)}`);
}

// ── What to move to ────────────────────────────────────────────────────────

const version = await resolveVersion(wanted);
const published = await Promise.all(PACKAGES.map((name) => manifest(name, version)));

const missing = PACKAGES.filter((_, i) => !published[i]);
if (missing.length) {
  fail(
    `${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not published at ${version}.\n` +
      `  Both packages have to exist at one version before WE can move to it.`,
  );
}

const [sdk, connect] = published;
if (sdk.gitHead && connect.gitHead && sdk.gitHead !== connect.gitHead) {
  fail(
    `${version} of the two packages was published from different commits ` +
      `(${sdk.gitHead.slice(0, 9)} and ${connect.gitHead.slice(0, 9)}). Publish both from one commit.`,
  );
}

// ── What it moves from ─────────────────────────────────────────────────────

const rootPath = join(ROOT, 'package.json');
const root = JSON.parse(readFileSync(rootPath, 'utf8'));
const before = PACKAGES.map((name) => root.pnpm?.overrides?.[name]);

if (before.every((v) => v === version)) {
  console.log(`Already on ${version}.`);
  process.exit(0);
}

// ── What changed in ad4m ───────────────────────────────────────────────────

const oldSdk = before[0] ? await manifest(PACKAGES[0], before[0]) : null;
const from = oldSdk?.gitHead;
const to = sdk.gitHead;
const compare = from && to ? await getJson(`https://api.github.com/repos/coasys/ad4m/compare/${from}...${to}`) : null;

if (compare && compare.ahead_by === 0 && compare.behind_by > 0 && !allowOlder) {
  fail(
    `${version} is ${compare.behind_by} ad4m commits behind the current pin (${before[0]}), and adds none.\n` +
      `  If that is really what you want, pass --allow-older.`,
  );
}

// ── Rewrite ────────────────────────────────────────────────────────────────

// An exact version (optionally with a pre-release), never a range or `*`: a peer range says
// what a package tolerates, which a bump is not deciding.
const EXACT = /^\d+\.\d+\.\d+(-[\w.-]+)?$/;

const workspaceManifests = execSync("git ls-files 'package.json' '*/package.json'", { cwd: ROOT })
  .toString()
  .trim()
  .split('\n');

const changed = [];
for (const file of workspaceManifests) {
  const path = join(ROOT, file);
  const text = readFileSync(path, 'utf8');
  const pkg = JSON.parse(text);
  let touched = false;
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const name of PACKAGES) {
      const current = pkg[field]?.[name];
      if (current && EXACT.test(current) && current !== version) {
        pkg[field][name] = version;
        touched = true;
      }
    }
  }
  if (file === 'package.json') {
    for (const name of PACKAGES) {
      if (pkg.pnpm?.overrides?.[name] !== version) {
        pkg.pnpm.overrides[name] = version;
        touched = true;
      }
    }
  }
  if (touched) {
    writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
    changed.push(file);
  }
}

console.log(`Moved ${PACKAGES.join(' and ')} to ${version}:`);
for (const file of changed) console.log(`  ${file}`);

if (install) {
  console.log('\nInstalling…');
  execSync('pnpm install', { cwd: ROOT, stdio: 'inherit' });
}

// ── For the PR description ─────────────────────────────────────────────────

console.log('\n── For the PR description ──\n');
console.log(`Moves the ad4m pin from \`${before[0]}\` to \`${version}\`.\n`);

if (!from || !to) {
  console.log('(npm records no source commit for one of the two versions, so the ad4m changes cannot be listed.)');
} else if (!compare) {
  console.log(`(GitHub could not compare ${from.slice(0, 9)}...${to.slice(0, 9)}.)`);
} else {
  // Merges of one branch into another say nothing a reviewer needs; a merged pull request does.
  const commits = (compare.commits ?? []).filter(
    (c) => !/^Merge (branch|remote-tracking|origin|.+ into )/.test(c.commit.message.split('\n')[0]),
  );
  const shown = commits.slice(-50);
  console.log(`ad4m changes (${compare.ahead_by} commits, ${from.slice(0, 9)}...${to.slice(0, 9)}):\n`);
  for (const c of shown) {
    console.log(`- ${c.commit.message.split('\n')[0]} (coasys/ad4m@${c.sha.slice(0, 9)})`);
  }
  if (!shown.length) console.log('- none');
  if (compare.behind_by > 0) {
    console.log(
      `\nNote: the new version is also ${compare.behind_by} commits *behind* the old one. ` +
        'It was published from a branch that does not contain everything the old pin had.',
    );
  }
  if (compare.ahead_by > shown.length) {
    console.log(`\n(Showing the latest ${shown.length}; full list: ${compare.html_url})`);
  }
}

console.log('\nNext: run `pnpm verify:ad4m` against a local executor at this version, then open the PR.');
