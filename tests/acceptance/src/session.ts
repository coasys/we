/**
 * The run's own desktop session: a D-Bus session bus (`dbus-run-session`) and a runtime folder
 * (`XDG_RUNTIME_DIR`) made for the run. Every service the bus starts on demand (a keyring, a desktop
 * portal) starts in that folder, so none of them finds the person's own keyring and serves it to
 * the app under test.
 *
 * Each app a scenario launches gets a session bus of its own inside that (`startAppBus`), in the
 * app's own runtime folder: what one app's bus starts on demand (the portal, a Secret Service) is
 * gone with it, so the next app, or a keyring the driver starts, never meets it.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Proc } from './world/proc.ts';

const INSIDE = 'WE_ACCEPTANCE_SESSION';

/**
 * Inside the run's session, answers true. Outside it, runs this same command again inside a new one,
 * waits for it, exits with its status, and answers false.
 */
export async function inSession(): Promise<boolean> {
  if (process.env[INSIDE] === '1') return true;
  const runtime = mkdtempSync(join(tmpdir(), 'we-acceptance-run-'));
  const child = spawn('dbus-run-session', ['--', process.execPath, ...process.execArgv, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, [INSIDE]: '1', XDG_RUNTIME_DIR: runtime },
  });
  const status = await new Promise<number>((resolve) => {
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    child.on('error', (error) => {
      console.error(`dbus-run-session: ${error.message}`);
      resolve(2);
    });
  });
  unmountUnder(runtime);
  rmSync(runtime, { recursive: true, force: true });
  process.exitCode = status;
  return false;
}

/**
 * Services the bus started mount FUSE file systems in the runtime folder (the desktop portal's
 * `doc`, gvfs). They outlive the bus as stale mounts, and a removal through one fails, so this
 * detaches each mount under `dir` first.
 */
export function unmountUnder(dir: string): void {
  let mounts: string[];
  try {
    mounts = readFileSync('/proc/self/mounts', 'utf8')
      .split('\n')
      .map((line) => (line.split(' ')[1] ?? '').replace(/\\040/g, ' '))
      .filter((point) => point.startsWith(`${dir}/`));
  } catch {
    return;
  }
  for (const point of mounts) {
    spawnSync('fusermount3', ['-u', '-z', point], { stdio: 'ignore' });
  }
}

/** What starts a process that stops with its owner: `LocalWorld.spawn`, or a `Proc` in a test. */
export type SpawnProc = (
  label: string,
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv },
) => Proc;

export interface AppBus {
  /** The bus's `DBUS_SESSION_BUS_ADDRESS`. */
  address: string;
  proc: Proc;
}

/**
 * A D-Bus session bus of one app's own, listening in `runtime` and started with `env` — so the
 * services it starts on demand get that app's home and runtime folder. Answers once it is accepting
 * connections.
 */
export async function startAppBus(
  spawnProc: SpawnProc,
  label: string,
  runtime: string,
  env: NodeJS.ProcessEnv,
): Promise<AppBus> {
  const proc = spawnProc(
    label,
    'dbus-daemon',
    [
      '--session',
      '--nofork',
      '--nopidfile',
      '--nosyslog',
      `--address=unix:path=${join(runtime, 'bus')}`,
      '--print-address=1',
    ],
    { env },
  );
  const address = (await proc.waitFor((line) => line.startsWith('unix:'), 10_000, 'bus address')).trim();
  return { address, proc };
}
