/**
 * Which builds a local world runs: the ad4m checkout (`AD4M_REPO`) for the identity store, the
 * executors and the test languages, and the desktop app's harness build (`WE_HARNESS_APP`).
 *
 * The ad4m checkout must be at the commit WE pins (`node scripts/ad4m-pin.mjs --commit`), or a
 * descendant of it while an ad4m change is under review, with these built:
 *
 * ```sh
 * cargo build --release --bin ad4m-executor
 * cargo build --release -p identity-store
 * cd tests/js && pnpm run prepare-test-local   # the test languages, the centralised agent language
 * ```
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

export interface Checkout {
  ad4m: string;
  /** The ad4m commit the checkout is at, for the report. */
  ad4mCommit: string;
  executor: string;
  identityStore: string;
  /** `<ad4m>/tests/js`, where the executors run with the shared test language directories. */
  testsJs: string;
  /** The desktop app's harness build, when the scenarios need it. */
  app: string;
}

function firstExisting(paths: string[]): string | undefined {
  return paths.find((p) => existsSync(p));
}

/** Resolves the checkout and checks that what the world runs is built. Throws with what to do. */
export function resolveCheckout(env: NodeJS.ProcessEnv = process.env): Checkout {
  const ad4m = env.AD4M_REPO ? resolve(env.AD4M_REPO) : resolve(WE_ROOT, '../ad4m');
  if (!existsSync(join(ad4m, 'rust-executor'))) {
    throw new Error(`no ad4m checkout at ${ad4m}: set AD4M_REPO`);
  }
  const target = env.AD4M_TARGET_DIR ? resolve(env.AD4M_TARGET_DIR) : join(ad4m, 'target');
  const executor = env.AD4M_EXECUTOR ? resolve(env.AD4M_EXECUTOR) : join(target, 'release/ad4m-executor');
  if (!existsSync(executor)) {
    throw new Error(`no executor at ${executor}: run \`cargo build --release --bin ad4m-executor\` in ${ad4m}`);
  }
  const identityStore = firstExisting([join(target, 'release/identity-store'), join(target, 'debug/identity-store')]);
  if (!identityStore) {
    throw new Error(`no identity-store in ${target}: run \`cargo build --release -p identity-store\` in ${ad4m}`);
  }
  const testsJs = join(ad4m, 'tests/js');
  if (!existsSync(join(testsJs, 'scripts/centralized-agent-language-hash'))) {
    throw new Error(`the test languages are not prepared: run \`pnpm run prepare-test-local\` in ${testsJs}`);
  }
  const app = env.WE_HARNESS_APP
    ? resolve(env.WE_HARNESS_APP)
    : join(
        env.CARGO_TARGET_DIR ? resolve(env.CARGO_TARGET_DIR) : join(WE_ROOT, 'apps/we-tauri/src-tauri/target'),
        'release/we',
      );
  let ad4mCommit = 'unknown';
  try {
    ad4mCommit = execFileSync('git', ['-C', ad4m, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    // Not a git checkout: the report says unknown.
  }
  return { ad4m, ad4mCommit, executor, identityStore, testsJs, app };
}

/** The commit WE pins ad4m to, or undefined when the pin cannot be read. */
export function pinnedAd4mCommit(): string | undefined {
  try {
    return execFileSync('node', [join(WE_ROOT, 'scripts/ad4m-pin.mjs'), '--commit'], { encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}
