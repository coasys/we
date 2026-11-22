#!/usr/bin/env node
/**
 * The one reader of WE's ad4m pin.
 *
 *   node scripts/ad4m-pin.mjs [--commit] [--from <package.json | ->]
 *   node scripts/ad4m-pin.mjs --check-lockfile [<pnpm-lock.yaml>]
 *
 * The pin is the root `pnpm.overrides` entry for @coasys/ad4m, @coasys/connect and
 * @coasys/identity-wasm (the identity core for the browser, which the identity site loads), and it
 * is one of two kinds:
 *
 * - **A snapshot**: `https://pkg.pr.new/coasys/ad4m/<package>@<commit>`, which ad4m publishes for
 *   every commit on `dev` and every pull request head. `dev` and feature branches pin these.
 * - **A version** published to npm (`0.13.1-staging.2`). Releases pin these, because a version
 *   never expires and a snapshot does.
 *
 * Every workflow and script that needs to know which ad4m WE is on asks here rather than reading
 * the override itself, because the two kinds answer "which commit" differently: a snapshot's commit
 * is in its URL, and only there — its package.json carries the release's version and no `gitHead`
 * — while a version's commit is the `gitHead` npm recorded when it was published.
 *
 * Refused, rather than guessed at: a short sha (the cache key, the concurrency group and GitHub's
 * compare API all take the full one), a URL that is not exactly the snapshot form, the two packages
 * pinned to different commits or versions, and one package pinned by version and the other by
 * snapshot. The app's client comes from the SDK bundled inside @coasys/connect, so core and connect
 * from different ad4m commits is a combination nobody tested.
 *
 * Prints `kind=`, then `commit=` or `version=`, one per line, for a shell to read. With --commit,
 * prints only the commit, resolving a version's from npm. --from reads another package.json (`-`
 * for stdin), which is how a workflow reads the base branch's pin.
 *
 * --check-lockfile fails when a snapshot's lockfile entry has no `integrity`. pnpm records none for
 * a tarball URL, so without it a frozen install accepts whatever bytes the URL serves; `pnpm
 * bump:ad4m` writes it, and this catches a re-resolve that dropped it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PACKAGES = ['@coasys/ad4m', '@coasys/connect', '@coasys/identity-wasm'];
export const AD4M_REPO = 'coasys/ad4m';
export const SNAPSHOT_BASE = `https://pkg.pr.new/${AD4M_REPO}/`;
const REGISTRY = 'https://registry.npmjs.org';

const VERSION = /^\d+\.\d+\.\d+(-[\w.-]+)?$/;
const FULL_SHA = /^[0-9a-f]{40}$/;

export class PinError extends Error {}

/** Where a package's snapshot of one ad4m commit installs from. */
export function snapshotUrl(name, commit) {
  return `${SNAPSHOT_BASE}${name}@${commit}`;
}

/** One package's override, as `{ kind, commit | version }`. */
function parseOne(name, spec) {
  if (typeof spec !== 'string' || !spec) throw new PinError(`${name} has no override in the root package.json.`);
  if (VERSION.test(spec)) return { kind: 'version', version: spec };
  const prefix = `${SNAPSHOT_BASE}${name}@`;
  if (spec.startsWith(prefix)) {
    const commit = spec.slice(prefix.length);
    if (FULL_SHA.test(commit)) return { kind: 'snapshot', commit };
    if (/^[0-9a-f]{7,39}$/.test(commit)) {
      throw new PinError(
        `${name} is pinned to the short sha ${commit}. Pin the full 40-character commit (pnpm bump:ad4m ${commit} expands it).`,
      );
    }
  }
  throw new PinError(
    `${name} is pinned to \`${spec}\`, which is neither an npm version nor ${prefix}<full commit sha>.`,
  );
}

/** The pin the root `pnpm.overrides` hold: `{ kind: 'snapshot', commit }` or `{ kind: 'version', version }`. */
export function parsePin(overrides) {
  const [first, ...rest] = PACKAGES.map((name) => parseOne(name, overrides?.[name]));
  for (const [i, other] of rest.entries()) {
    const name = PACKAGES[i + 1];
    if (first.kind !== other.kind) {
      throw new PinError(
        `${PACKAGES[0]} is pinned by ${first.kind} and ${name} by ${other.kind}. Pin all of them the same way.`,
      );
    }
    if (first.kind === 'snapshot' && first.commit !== other.commit) {
      throw new PinError(
        `${PACKAGES[0]} and ${name} are pinned to different ad4m commits (${first.commit.slice(0, 9)} and ${other.commit.slice(0, 9)}). Pin all of them to one.`,
      );
    }
    if (first.kind === 'version' && first.version !== other.version) {
      throw new PinError(
        `${PACKAGES[0]} is pinned to ${first.version} and ${name} to ${other.version}. Pin all of them to one version.`,
      );
    }
  }
  return first;
}

/** The pin in a package.json's text, or in the repository's own. */
export function readPin(text = readFileSync(join(ROOT, 'package.json'), 'utf8')) {
  return parsePin(JSON.parse(text).pnpm?.overrides);
}

/** The commit npm recorded a version as published from, or undefined. */
export async function versionCommit(version, name = PACKAGES[0]) {
  const response = await fetch(`${REGISTRY}/${name.replace('/', '%2f')}/${encodeURIComponent(version)}`);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new PinError(`npm answered ${response.status} for ${name}@${version}.`);
  return (await response.json()).gitHead || undefined;
}

/** The ad4m commit a pin stands for. */
export async function pinCommit(pin) {
  if (pin.kind === 'snapshot') return pin.commit;
  const commit = await versionCommit(pin.version);
  if (!commit) {
    throw new PinError(
      `${PACKAGES[0]}@${pin.version} on npm records no gitHead, so the ad4m commit it stands for is unknown.`,
    );
  }
  return commit;
}

/** The pin in words, for a log line or a PR description. */
export function describePin(pin) {
  return pin.kind === 'snapshot' ? `the ad4m snapshot of ${pin.commit.slice(0, 9)}` : `ad4m ${pin.version}`;
}

// ── The lockfile ───────────────────────────────────────────────────────────

/**
 * Every snapshot tarball in a pnpm lockfile's `packages:` section, with the integrity its
 * `resolution` records, if any.
 */
export function lockfileSnapshots(text) {
  const found = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s+resolution: \{(.*)\}\s*$/);
    if (!m) continue;
    const fields = Object.fromEntries(
      m[1].split(', ').map((pair) => {
        const at = pair.indexOf(': ');
        return [pair.slice(0, at), pair.slice(at + 2)];
      }),
    );
    if (fields.tarball?.startsWith(SNAPSHOT_BASE)) found.push({ tarball: fields.tarball, integrity: fields.integrity });
  }
  return found;
}

/**
 * The lockfile with `integrity` written into each listed tarball's `resolution`. pnpm keeps a line
 * written this way through later installs, and enforces it.
 */
export function withIntegrity(text, integrities) {
  return text.replace(/^(\s+)resolution: \{tarball: (\S+)\}\s*$/gm, (line, indent, tarball) =>
    integrities[tarball] ? `${indent}resolution: {integrity: ${integrities[tarball]}, tarball: ${tarball}}` : line,
  );
}

// ── Command line ───────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args.includes('--check-lockfile')) {
      const path = args.find((a) => !a.startsWith('--')) ?? join(ROOT, 'pnpm-lock.yaml');
      const snapshots = lockfileSnapshots(readFileSync(path, 'utf8'));
      const bare = snapshots.filter((s) => !s.integrity);
      if (bare.length) {
        throw new PinError(
          `The lockfile installs ${bare.length === 1 ? 'a snapshot' : `${bare.length} snapshots`} with no integrity, so a frozen install would accept whatever bytes the URL serves:\n` +
            bare.map((s) => `  ${s.tarball}`).join('\n') +
            '\n  Run `pnpm bump:ad4m` for the pinned commit, which writes it.',
        );
      }
      console.log(
        `${snapshots.length} snapshot tarball${snapshots.length === 1 ? '' : 's'} in the lockfile, each with its integrity.`,
      );
    } else {
      const from = args[args.indexOf('--from') + 1];
      const pin = args.includes('--from') ? readPin(readFileSync(from === '-' ? 0 : from, 'utf8')) : readPin();
      if (args.includes('--commit')) {
        console.log(await pinCommit(pin));
      } else {
        console.log(`kind=${pin.kind}`);
        console.log(pin.kind === 'snapshot' ? `commit=${pin.commit}` : `version=${pin.version}`);
      }
    }
  } catch (error) {
    if (!(error instanceof PinError)) throw error;
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}
