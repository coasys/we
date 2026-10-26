/**
 * Which executor WE runs, and what the cache keeps. The contracts worth pinning: a person's own
 * choice of binary always wins over the pin, the pin's executor is found by its commit alone, and
 * pruning never removes the executor in use.
 *
 * `node:test` rather than vitest: root tooling, and the workflow that runs the download script's
 * tests runs these.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { cacheDir, cachedExecutor, chooseExecutor, prune } from './ad4m-executor.mjs';

const PINNED = 'a'.repeat(40);
const ROOT = '/repo/we';
const DIR = '/cache/we/ad4m-executor';

describe('which executor runs', () => {
  it("is the pin's cached executor when nothing names another", () => {
    assert.deepEqual(chooseExecutor({ env: {}, seed: {}, commit: PINNED, root: ROOT, dir: DIR }), {
      path: `${DIR}/${PINNED}/ad4m-executor`,
      source: 'pin',
      commit: PINNED,
    });
  });

  it("is the seed's own build when it names one, from the repository root", () => {
    const seed = { ad4m: { executorPath: '../ad4m/target/release/ad4m-executor' } };
    assert.deepEqual(chooseExecutor({ env: {}, seed, commit: PINNED, root: ROOT, dir: DIR }), {
      path: '/repo/ad4m/target/release/ad4m-executor',
      source: 'seed',
    });
  });

  it('is AD4M_EXECUTOR over the seed', () => {
    const seed = { ad4m: { executorPath: '../ad4m/x' } };
    const env = { AD4M_EXECUTOR: '/ci/ad4m-executor' };
    assert.deepEqual(chooseExecutor({ env, seed, commit: PINNED, root: ROOT, dir: DIR }), {
      path: '/ci/ad4m-executor',
      source: 'env',
    });
  });

  it('expands a home path', () => {
    const seed = { ad4m: { executorPath: '~/bin/ad4m' } };
    assert.equal(chooseExecutor({ env: {}, seed, commit: PINNED, root: ROOT }).path, join(homedir(), 'bin/ad4m'));
  });
});

describe('the cache', () => {
  it('follows XDG_CACHE_HOME, and ~/.cache without it', () => {
    assert.equal(cacheDir({ XDG_CACHE_HOME: '/xdg' }), '/xdg/we/ad4m-executor');
    assert.equal(cacheDir({}), join(homedir(), '.cache', 'we', 'ad4m-executor'));
  });

  it('keys an executor by its commit', () => {
    assert.equal(cachedExecutor(PINNED, DIR), `${DIR}/${PINNED}/ad4m-executor`);
  });
});

describe('pruning', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ad4m-executor-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** A cached commit, last used `age` seconds ago. */
  const cached = (commit, age) => {
    mkdirSync(join(dir, commit));
    const used = new Date(Date.now() - age * 1000);
    utimesSync(join(dir, commit), used, used);
  };

  it('keeps the most recently used, counting the current one among them', () => {
    const commits = ['1', '2', '3', '4'].map((c) => c.repeat(40));
    commits.forEach((c, i) => cached(c, i * 10));
    cached(PINNED, 1000);

    const removed = prune(dir, PINNED, 3);

    assert.deepEqual(removed.sort(), [commits[2], commits[3]].sort());
    assert.deepEqual(readdirSync(dir).sort(), [PINNED, commits[0], commits[1]].sort());
  });

  it('never removes the current one, however long since it was used', () => {
    cached(PINNED, 1_000_000);
    cached('b'.repeat(40), 0);
    prune(dir, PINNED, 1);
    assert.ok(existsSync(join(dir, PINNED)));
  });

  it('leaves alone anything that is not a commit', () => {
    mkdirSync(join(dir, 'notes'));
    prune(dir, PINNED, 1);
    assert.ok(existsSync(join(dir, 'notes')));
  });

  it('has nothing to do when there is no cache yet', () => {
    assert.deepEqual(prune(join(dir, 'absent'), PINNED), []);
  });
});
