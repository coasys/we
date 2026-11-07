/**
 * Which builds a local world runs: the ad4m checkout (`AD4M_REPO`) for the identity store, the
 * executors and the test languages, and the desktop app's harness build: the Electron app
 * (`apps/we-electron`, or `WE_ELECTRON_APP`) by default, the Tauri app's (`WE_HARNESS_APP`) with
 * `--host tauri`.
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
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
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
  /** Which desktop app the scenarios drive. */
  host: Host;
  /**
   * The desktop app's harness build: the Tauri binary, or the Electron app's folder (`apps/we-electron`),
   * which `electron` runs.
   */
  app: string;
  /** The Electron binary that runs `app`, for the Electron host. */
  electron?: string;
}

/**
 * The desktop app a run drives. Electron is the desktop app WE ships, and the default; the Tauri app
 * is driven too, so it keeps working.
 */
export type Host = 'electron' | 'tauri';
export const HOSTS: Host[] = ['electron', 'tauri'];

function firstExisting(paths: string[]): string | undefined {
  return paths.find((p) => existsSync(p));
}

/**
 * The Electron app as the run drives it: the main process from `apps/we-electron/electron`, not
 * packaged (a package leaves the harness out), with the release renderer bundle (`dist`), the
 * custody sidecar's harness build where the unpackaged app finds it, and the world's executor named
 * in the generated runtime settings. Throws with what to do when one is missing.
 */
function electronApp(env: NodeJS.ProcessEnv, executor: string): { app: string; electron: string } {
  const app = env.WE_ELECTRON_APP ? resolve(env.WE_ELECTRON_APP) : join(WE_ROOT, 'apps/we-electron');
  const build = `run \`pnpm --filter '@we/app-electron...' build\` (with AD4M_EXECUTOR=${executor})`;
  if (!existsSync(join(app, 'dist/index.html')) || !existsSync(join(app, 'dist/identity/index.html'))) {
    throw new Error(`the Electron app's renderer is not built in ${app}: ${build}`);
  }
  let runtime: { ad4mExecutorPath?: string } = {};
  try {
    runtime = JSON.parse(readFileSync(join(app, 'electron/seed-runtime.json'), 'utf8'));
  } catch {
    throw new Error(`no electron/seed-runtime.json in ${app}: ${build}`);
  }
  // The app starts the executor its runtime settings name: it must be the one this world runs.
  const named = runtime.ad4mExecutorPath;
  if (!named || !existsSync(named) || realpathSync(named) !== realpathSync(executor)) {
    throw new Error(
      `the Electron app runs the executor at ${named ?? '(none)'}, not this world's ${executor}: ` +
        `run \`AD4M_EXECUTOR=${executor} node scripts/generate-seed-config.cjs\` in ${app}`,
    );
  }
  // The sidecar the unpackaged app starts is the one of its own checkout (`main.js`, `custodyBinary`),
  // which is another checkout's when `WE_ELECTRON_APP` names one. A release sidecar would keep the
  // run's custody items in a keyring or a file of the app's home.
  const custodyCrate = resolve(app, '../../crates/custody');
  const sidecar = join(custodyCrate, 'target/release/we-custody');
  if (!existsSync(sidecar) || !readFileSync(sidecar).includes('the harness build: custody items in memory')) {
    throw new Error(
      `no harness build of the custody sidecar at ${sidecar}: run \`cargo build --release --locked --bin we-custody --features harness\` in ${custodyCrate}`,
    );
  }
  let electron: string;
  try {
    electron = createRequire(join(app, 'package.json'))('electron') as string;
  } catch {
    throw new Error(`no Electron in ${app}: run \`pnpm install\``);
  }
  return { app, electron };
}

/** Resolves the checkout and checks that what the world runs is built. Throws with what to do. */
export function resolveCheckout(host: Host = 'electron', env: NodeJS.ProcessEnv = process.env): Checkout {
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
  const desktop =
    host === 'electron'
      ? electronApp(env, executor)
      : {
          app: env.WE_HARNESS_APP
            ? resolve(env.WE_HARNESS_APP)
            : join(
                env.CARGO_TARGET_DIR ? resolve(env.CARGO_TARGET_DIR) : join(WE_ROOT, 'apps/we-tauri/src-tauri/target'),
                'release/we',
              ),
        };
  let ad4mCommit = 'unknown';
  try {
    ad4mCommit = execFileSync('git', ['-C', ad4m, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    // Not a git checkout: the report says unknown.
  }
  return { ad4m, ad4mCommit, executor, identityStore, testsJs, host, ...desktop };
}

/** The commit WE pins ad4m to, or undefined when the pin cannot be read. */
export function pinnedAd4mCommit(): string | undefined {
  try {
    return execFileSync('node', [join(WE_ROOT, 'scripts/ad4m-pin.mjs'), '--commit'], { encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}
