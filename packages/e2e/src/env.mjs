/**
 * Which programs an end-to-end test runs: the ad4m executor and Chrome. Each is chosen in one place,
 * so every kind of test runs the same binaries and names them with the same variables.
 *
 * - The executor is the one `scripts/ad4m-executor.mjs` chooses, for the app and every test alike:
 *   `AD4M_EXECUTOR`, else the seed's `ad4m.executorPath`, else the pinned commit's download
 *   (`pnpm ad4m:executor`).
 * - Chrome is `WE_CHROME` when it is set, else the first of Playwright's own Chromium and the usual
 *   system paths that exists.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

/** The repository's root: this file is `packages/e2e/src/env.mjs`. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * The executor binary, as `scripts/ad4m-executor.mjs --path` names it. Fetches nothing: a missing
 * one throws, saying how to get it.
 */
export function executorBinary() {
  const chosen = spawnSync(process.execPath, [join(ROOT, 'scripts', 'ad4m-executor.mjs'), '--path'], {
    encoding: 'utf8',
  });
  if (chosen.status !== 0) throw new Error(`Could not work out which executor to run:\n${chosen.stderr}`);
  const binary = chosen.stdout.trim();
  if (!existsSync(binary)) {
    throw new Error(
      `No executor at ${binary}. Run \`pnpm ad4m:executor\` to download the pinned one, or set ` +
        'AD4M_EXECUTOR to an ad4m-executor binary.',
    );
  }
  return binary;
}

/** Where Chrome might be when `WE_CHROME` does not say, in the order they are tried. */
export function chromeCandidates() {
  let playwrights;
  try {
    playwrights = chromium.executablePath();
  } catch {
    playwrights = undefined;
  }
  return [playwrights, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
}

/**
 * The Chrome to drive. `WE_CHROME` is taken as it is, and a path that is not there throws rather than
 * falling back to another browser: a test told which browser to use should not quietly use another.
 */
export function chromePath(env = process.env) {
  if (env.WE_CHROME) {
    if (!existsSync(env.WE_CHROME)) throw new Error(`WE_CHROME is ${env.WE_CHROME}, and there is nothing there.`);
    return env.WE_CHROME;
  }
  const found = chromeCandidates().find((path) => existsSync(path));
  if (!found) throw new Error('No Chrome or Chromium found. Set WE_CHROME to one.');
  return found;
}
