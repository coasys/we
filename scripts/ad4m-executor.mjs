#!/usr/bin/env node
/**
 * Which ad4m executor WE runs, and fetching it when that is the pinned one.
 *
 *   pnpm ad4m:executor [--soft]     make sure the executor WE would run is there
 *   node scripts/ad4m-executor.mjs --path   print where it is, fetching nothing
 *
 * The client and the executor have to come from one ad4m commit. The pin installs the client; the
 * executor used to be whatever binary sat in a sibling ad4m checkout, from whatever commit it was
 * built, and the mismatch surfaced as a WS method that does not exist or a call that hangs. So the
 * executor is now chosen here, once, for the Electron app, the live tests and the workspace setup,
 * in this order:
 *
 * 1. `AD4M_EXECUTOR`, a path. CI's packaging sets it to the binary its executor action fetched.
 * 2. The seed's `ad4m.executorPath`. A seed names one only to run a build of its own — someone
 *    working on ad4m pointing at their checkout's `target/release/ad4m-executor`.
 * 3. Otherwise the pinned commit's executor, in a cache outside both repositories:
 *    `$XDG_CACHE_HOME/we/ad4m-executor/<commit>/ad4m-executor` (`~/.cache/…` without it).
 *
 * The first two are a person's own choice, so they are reported and never replaced. The third is
 * downloaded when it is missing (see `ad4m-executor-download.mjs`), in seconds rather than the better
 * part of an hour `cargo build` takes. Keyed by commit, it needs no record of what it holds: a file
 * there is that commit's, because it is only ever written whole, by a rename. Moving between branches
 * that pin different commits finds each one already there, and every WE checkout shares the cache.
 * The few most recently used commits are kept and the rest removed.
 *
 * Without `--soft`, an executor that is not there exits 1, so success means it is. `--soft` is for
 * `electron:dev`: it says what is wrong and exits 0, so a laptop offline, or on macOS where ad4m
 * publishes nothing, still gets as far as the app's own error.
 */
import { existsSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AD4M_REPO,
  checkPlatform,
  fetchExecutor,
  Mismatch,
  NotPublished,
  writeExecutor,
} from './ad4m-executor-download.mjs';
import { pinCommit, readPin, ROOT } from './ad4m-pin.mjs';

const { readSeed, seedLabel } = createRequire(import.meta.url)('./seed.cjs');

/** How many commits' executors the cache keeps: enough to move between a few branches freely. */
export const KEEP = 5;

/** Where downloaded executors are kept, one directory per ad4m commit. */
export function cacheDir(env = process.env) {
  return join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'we', 'ad4m-executor');
}

/** The cached executor for one commit. */
export function cachedExecutor(commit, dir = cacheDir()) {
  return join(dir, commit, 'ad4m-executor');
}

function expand(path, root) {
  if (path === '~' || path.startsWith('~/')) return join(homedir(), path.slice(1));
  return isAbsolute(path) ? path : resolve(root, path);
}

/**
 * The executor to run, as `{ path, source, commit? }`: source is `env`, `seed` or `pin` (see the
 * header), and `commit` comes with `pin`. A seed's relative path is from the repository root.
 */
export function chooseExecutor({ env = process.env, seed, commit, root = ROOT, dir = cacheDir(env) }) {
  if (env.AD4M_EXECUTOR) return { path: expand(env.AD4M_EXECUTOR, root), source: 'env' };
  if (seed?.ad4m?.executorPath) return { path: expand(seed.ad4m.executorPath, root), source: 'seed' };
  return { path: cachedExecutor(commit, dir), source: 'pin', commit };
}

/**
 * The executor WE runs, for the pin and seed in this checkout. The pin is read only when it decides,
 * since reading a version pin asks npm.
 */
export async function resolveExecutor(env = process.env) {
  const seed = readSeed();
  const chosen = chooseExecutor({ env, seed, commit: '' });
  return chosen.source === 'pin' ? chooseExecutor({ env, seed, commit: await pinCommit(readPin()) }) : chosen;
}

/**
 * Removes all but the `keep` most recently used commits' executors, never `current`. Use is the
 * directory's mtime, which a run that finds one there refreshes.
 */
export function prune(dir, current, keep = KEEP) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const removed = entries
    .filter((e) => e.isDirectory() && /^[0-9a-f]{40}$/.test(e.name) && e.name !== current)
    .map((e) => ({ name: e.name, used: statSync(join(dir, e.name)).mtimeMs }))
    .sort((a, b) => b.used - a.used)
    .slice(Math.max(keep - 1, 0))
    .map((e) => e.name);
  for (const name of removed) rmSync(join(dir, name), { recursive: true, force: true });
  return removed;
}

const short = (commit) => `${AD4M_REPO}@${commit.slice(0, 9)}`;

/** A path as a person reads it: from the repository when it is inside it, else from home. */
function display(path) {
  const inRepo = relative(ROOT, path);
  if (!inRepo.startsWith('..') && !isAbsolute(inRepo)) return inRepo;
  return path.startsWith(`${homedir()}/`) ? `~/${relative(homedir(), path)}` : path;
}

async function main(args) {
  const soft = args.includes('--soft');
  const say = (line) => console.error(soft ? `[ad4m:executor] ${line}` : line);
  const fail = (line) => {
    say(line);
    process.exitCode = soft ? 0 : 1;
  };

  if (args.includes('--path')) {
    console.log((await resolveExecutor()).path);
    return;
  }
  if (process.env.WE_EXTERNAL_AD4M_PORT) {
    say('WE_EXTERNAL_AD4M_PORT is set, so the app uses an executor already running and starts none.');
    return;
  }

  const { path, source, commit } = await resolveExecutor();
  const where = display(path);

  if (source !== 'pin') {
    const from = source === 'env' ? 'AD4M_EXECUTOR' : seedLabel();
    if (!existsSync(path)) {
      fail(`✗ ${from} names ${where}, and there is nothing there.`);
      return;
    }
    say(
      `${from} names ${where}, so that runs rather than the pinned executor. It is not checked ` +
        `against the pin: make sure it was built from a commit that matches (scripts/ad4m-pin.mjs --commit).`,
    );
    return;
  }

  const dir = cacheDir();
  if (existsSync(path)) {
    // Marks it used, so pruning keeps what is in use rather than what was downloaded last.
    const now = new Date();
    utimesSync(join(dir, commit), now, now);
    say(`✓ ${short(commit)}, the pinned executor, is at ${where}.`);
    return;
  }

  say(`Downloading ${short(commit)}'s executor, the one the pin stands for…`);
  try {
    checkPlatform();
    const { binary, manifest } = await fetchExecutor(commit);
    writeExecutor(path, binary);
    say(`✓ ${short(commit)} is at ${where} (needs glibc ${manifest.glibc}).`);
    const removed = prune(dir, commit);
    if (removed.length) say(`Removed ${removed.length} older executor(s) from ${dir}.`);
  } catch (error) {
    // A download that is not the file its manifest describes is never written, and is worth stopping for.
    if (error instanceof Mismatch) {
      say(`✗ ${error.message}`);
      process.exitCode = 1;
      return;
    }
    if (!(error instanceof NotPublished)) throw error;
    fail(
      `✗ No executor to download: ${error.message}\n` +
        `  Build it from the pinned commit in an ad4m checkout, and point the seed's ad4m.executorPath\n` +
        `  (or AD4M_EXECUTOR) at it:\n` +
        `    git checkout ${commit} && cargo build --release --bin ad4m-executor`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    await main(args);
  } catch (error) {
    // A pin that cannot be read, a seed that will not parse: the soft check reports it and lets the
    // app start, since the app has its own way of failing on either.
    if (!args.includes('--soft')) throw error;
    console.error(`[ad4m:executor] Could not check the executor: ${error.message}`);
  }
}
