/**
 * The run's own desktop session: a D-Bus session bus (`dbus-run-session`) and a runtime folder
 * (`XDG_RUNTIME_DIR`) made for the run. Every service the bus starts on demand (a keyring, a desktop
 * portal) starts in that folder, so none of them finds the person's own keyring and serves it to
 * the app under test.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
function unmountUnder(dir: string): void {
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
