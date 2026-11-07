/**
 * The desktop driver: the desktop app's harness build, started on the run's X display inside the
 * run's D-Bus session, and driven through its harness link. The app is the Electron app by default
 * (`apps/we-electron/electron/harness.js`) or the Tauri app (`apps/we-tauri/src-tauri/src/harness.rs`);
 * both speak the same protocol, and where they differ the driver says so, not the scenario.
 *
 * A scenario reaches the app's windows only as a person would (`press`, `type`, `text`): through
 * the main window and the identity window, which runs every identity step in the custody service.
 * The harness build adds no command and no capability to the app; it reaches the windows from the
 * app's own process.
 *
 * The vault (`vault`):
 * - `memory`, the default: the custody service keeps its items in memory, so the run leaves nothing
 *   in the session's keyring.
 * - `os`: the Secret Service, from a `gnome-keyring-daemon` the driver starts on the app's own D-Bus
 *   session and unlocks, as a person's session is unlocked at login. On Linux the custody item is
 *   sealed under the passphrase the person types in the identity window either way: no OS prompt is
 *   shown, so there is nothing for the harness to answer.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';

import { type AppBus, startAppBus, unmountUnder } from '../session.ts';
import type { LocalWorld } from '../world/local.ts';
import { Proc } from '../world/proc.ts';
import type { Display } from './display.ts';
import { HarnessLink } from './harnessLink.ts';
import { withHelpers } from './page.ts';

export type Vault = 'memory' | 'os';
export type WindowLabel = 'main' | 'identity';

export interface CustodyPublic {
  did?: string | null;
  holdsMaster?: unknown;
  [key: string]: unknown;
}

export interface AppState {
  windows: { label: string; url: string }[];
  custody: CustodyPublic;
}

export interface IpcCall {
  at: number;
  window: string;
  command: string;
}

export interface LaunchOptions {
  name: string;
  vault?: Vault;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The port the Electron app serves its renderer on (`main.js`, `startAppServer`): fixed, on every
 * address, and the app listens for no bind error. Beside another WE that holds it, the app stops in
 * Electron's "A JavaScript error occurred in the main process" box: no window, no script answered,
 * and the scenario fails minutes later without a word of why.
 */
export const ELECTRON_LAUNCHER_PORT = 9080;

/** Throws, naming the port and what to do, when another process holds `port`. */
export async function assertPortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(
        new Error(
          `port ${port} is held by another process (${error.code}): the Electron app serves its renderer there ` +
            `and does not start beside it; stop the other WE first`,
        ),
      );
    });
    // The app's own call shape (`listen(port)`, every address), so the answer is the one it would get.
    server.listen(port, () => server.close(() => resolve()));
  });
}

export class DesktopApp {
  private constructor(
    readonly name: string,
    private readonly root: string,
    readonly home: string,
    readonly dataPath: string,
    private readonly link: HarnessLink,
    private readonly proc: Proc,
    private readonly keyring: Proc | null,
    private readonly bus: AppBus,
  ) {}

  /** Starts the harness build with a fresh home and data folder, and waits for it to dial in. */
  static async launch(world: LocalWorld, display: Display, options: LaunchOptions): Promise<DesktopApp> {
    const vault = options.vault ?? 'memory';
    const root = join(world.dir, `desktop-${options.name}`);
    const home = join(root, 'home');
    const dataPath = join(root, 'ad4m');
    // The app's own runtime folder too: in the person's, a keyring daemon finds the person's own
    // keyring and serves it.
    const runtime = join(root, 'run');
    for (const dir of [home, join(home, '.local/share'), join(home, '.config'), join(home, '.cache'), runtime]) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    // The executor in the app starts from this world's seed and test languages; `init` is the
    // bootstrap the release build does from its own seed.
    await world.initDataFolder(dataPath);
    // Before anything else starts: the Electron app cannot say when its port is taken.
    if (world.checkout.host === 'electron') await assertPortFree(ELECTRON_LAUNCHER_PORT);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      XDG_DATA_HOME: join(home, '.local/share'),
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_CACHE_HOME: join(home, '.cache'),
      XDG_RUNTIME_DIR: runtime,
      DISPLAY: display.name,
      // The run's X display only: with a Wayland socket named, a toolkit opens on the person's desktop.
      WAYLAND_DISPLAY: undefined,
      // Xvfb has no GPU: draw in software.
      WEBKIT_DISABLE_DMABUF_RENDERER: '1',
      WEBKIT_DISABLE_COMPOSITING_MODE: '1',
      LIBGL_ALWAYS_SOFTWARE: '1',
      WE_AD4M_DATA_PATH: dataPath,
      AD4M_IDENTITY_STORE_URL: world.storeUrl,
      AD4M_IDENTITY_STORE_KEYS: world.storeKey,
      COASYS_HARNESS_VAULT: vault,
    };

    // A bus of the app's own: one shared by the run's apps hands the next app whatever the last
    // one's bus started on demand — the portal starts a Secret Service, and then a keyring the
    // driver starts for `vault: 'os'` finds the name taken and never serves it.
    const bus = await startAppBus(world.spawn.bind(world), `dbus-${options.name}`, runtime, env);
    env.DBUS_SESSION_BUS_ADDRESS = bus.address;

    let keyring: Proc | null = null;
    try {
      if (vault === 'os') keyring = await startKeyring(world, env);
    } catch (error) {
      await bus.proc.stop();
      unmountUnder(root);
      throw error;
    }

    const link = await HarnessLink.listen();
    const { command, args } = appCommand(world, root, env);
    const proc = world.spawn(`desktop-${options.name}`, command, args, {
      cwd: world.checkout.testsJs,
      env: { ...env, COASYS_HARNESS_URL: link.url, COASYS_HARNESS_TOKEN: link.token },
    });
    const app = new DesktopApp(options.name, root, home, dataPath, link, proc, keyring, bus);
    try {
      await Promise.race([
        link.connected(120_000),
        proc.done().then(({ code, signal }) => {
          throw new Error(`the app exited before it dialled in: code ${code}, signal ${signal}\n${proc.tail(40)}`);
        }),
      ]);
      await app.waitFor(
        'main',
        'return document.readyState === "complete" && h.text().length > 0',
        120_000,
        'the main window',
      );
    } catch (error) {
      await app.stop();
      throw error;
    }
    return app;
  }

  /** Runs a script body in a window, with the person helpers in scope as `h`. */
  eval<T = unknown>(window: WindowLabel, body: string, timeoutMs = 60_000): Promise<T> {
    return this.link.send<T>('eval', { window, js: withHelpers(body) }, timeoutMs);
  }

  /**
   * Waits until a script body answers something truthy, and answers that. With `closes`, a window
   * that closes before the script answers ends the wait too, answering `undefined`.
   */
  async waitFor<T = unknown>(
    window: WindowLabel,
    body: string,
    timeoutMs: number,
    what: string,
    closes = false,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let last: unknown;
    while (Date.now() < deadline) {
      try {
        const value = await this.eval<T>(window, body, 30_000);
        if (value) return value;
        last = value;
      } catch (error) {
        last = error instanceof Error ? error.message : error;
        if (closes && String(last).includes(`the window ${window} closed before the script answered`)) {
          return undefined as T;
        }
      }
      await sleep(400);
    }
    const screen = await this.text(window).catch(() => '(the window cannot be read)');
    throw new Error(
      `waited ${timeoutMs / 1000} s for ${what}; last answer: ${JSON.stringify(last)}\nthe window shows:\n${screen.slice(0, 2000)}`,
    );
  }

  /** The text on screen in a window. */
  text(window: WindowLabel): Promise<string> {
    return this.eval<string>(window, 'return h.text();');
  }

  /** Waits until a window shows these words, and answers its text. */
  waitForText(window: WindowLabel, words: string, timeoutMs = 60_000): Promise<string> {
    return this.waitFor<string>(
      window,
      `const t = h.text(); return t.includes(${JSON.stringify(words)}) ? t : '';`,
      timeoutMs,
      `"${words}" in the ${window} window`,
    );
  }

  /**
   * Presses the control with these words, once one is on screen and enabled. A press that closes
   * its window ("Done") can close it before the script answers, which both hosts report: it pressed.
   */
  async press(window: WindowLabel, words: string, timeoutMs = 30_000): Promise<void> {
    const body = `const [el] = h.controls(${JSON.stringify(words)}); if (!el || el.disabled || el.hasAttribute('disabled')) return false; return h.press(${JSON.stringify(words)});`;
    await this.waitFor(window, body, timeoutMs, `an enabled "${words}" in the ${window} window`, true);
  }

  /** Types into the field with these words in its label or placeholder. */
  async type(window: WindowLabel, field: string, value: string, index = 0, timeoutMs = 30_000): Promise<void> {
    const body = `if (h.fields(${JSON.stringify(field)}).length <= ${index}) return false; h.type(${JSON.stringify(field)}, ${JSON.stringify(value)}, ${index}); return true;`;
    await this.waitFor(window, body, timeoutMs, `the field "${field}" in the ${window} window`);
  }

  /** Waits for a window with this label to be open, or to be gone. */
  async waitForWindow(label: WindowLabel, open: boolean, timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { windows } = await this.state();
      if (windows.some((w) => w.label === label) === open) {
        // A new window answers once its page has drawn.
        if (open)
          await this.waitFor(
            label,
            'return document.readyState === "complete" && h.text().length > 0',
            timeoutMs,
            `the ${label} window`,
          );
        return;
      }
      await sleep(300);
    }
    throw new Error(`the ${label} window did not ${open ? 'open' : 'close'} in ${timeoutMs / 1000} s`);
  }

  state(): Promise<AppState> {
    return this.link.send<AppState>('state');
  }

  /**
   * The commands the windows invoked. Electron names its channels as Tauri names its commands, with
   * `-` for `_` (`identity-flow-start`, `identity_flow_start`): the log speaks Tauri's names.
   */
  async ipcLog(since = 0): Promise<IpcCall[]> {
    const calls = await this.link.send<IpcCall[]>('ipc.log', { since });
    return calls.map((call) => ({ ...call, command: call.command.replaceAll('-', '_') }));
  }

  /** Connections to the harness link refused for a wrong token. */
  get refusedLinks(): number {
    return this.link.refused;
  }

  async stop(): Promise<void> {
    await this.link.close();
    // The Electron app quits on SIGTERM, and stops its executor and custody sidecar before it exits.
    await this.proc.stop(15_000);
    await this.keyring?.stop();
    await this.bus.proc.stop();
    // The portal its bus started mounts `doc` in the app's runtime folder; the world's folder is
    // removed after a pass.
    unmountUnder(this.root);
    // The Electron app starts its executor and sidecar in process groups of their own, so stopping
    // its group does not reach them: they must have gone with it.
    await noneLeftUnder(this.root);
  }
}

/**
 * How the host's harness build starts.
 *
 * Electron: the app folder, not packaged (a package leaves the harness out), with a user-data folder
 * of its own, on the run's X display: without `--ozone-platform=x11` it takes Wayland when the
 * session has it. It starts its own executor and custody sidecar as in production, so no external
 * executor is named, and it serves its built renderer, not a dev server.
 */
function appCommand(world: LocalWorld, root: string, env: NodeJS.ProcessEnv): { command: string; args: string[] } {
  const { host, app, electron } = world.checkout;
  if (host === 'tauri') return { command: app, args: [] };
  for (const name of [
    'WE_EXTERNAL_AD4M_PORT',
    'WE_EXTERNAL_AD4M_TOKEN',
    'VITE_DEV_SERVER_URL',
    'ELECTRON_RUN_AS_NODE',
    'ELECTRON_OZONE_PLATFORM_HINT',
  ]) {
    delete env[name];
  }
  if (!electron) throw new Error('no Electron binary in the checkout');
  const args = ['--ozone-platform=x11', `--user-data-dir=${join(root, 'electron')}`];
  if (!chromiumSandboxStarts(electron)) {
    console.warn(
      `[desktop] Chromium's sandbox cannot start on this computer (unprivileged user namespaces are refused and ` +
        `${join(dirname(electron), 'chrome-sandbox')} is not setuid root): the app runs without it`,
    );
    args.push('--no-sandbox');
  }
  return { command: electron, args: [...args, app] };
}

/**
 * Whether Chromium's sandbox can start here: through an unprivileged user namespace, or else the
 * setuid helper beside Electron. Ubuntu 24.04 refuses the first to unconfined programs; CI makes the
 * helper setuid root, so the run there is sandboxed as a shipped app is.
 */
function chromiumSandboxStarts(electron: string): boolean {
  try {
    const helper = statSync(join(dirname(electron), 'chrome-sandbox'));
    if (helper.uid === 0 && helper.mode & 0o4000) return true;
  } catch {
    // No helper: the namespace sandbox or nothing.
  }
  const read = (file: string) => {
    try {
      return readFileSync(file, 'utf8').trim();
    } catch {
      return undefined;
    }
  };
  return (
    read('/proc/sys/kernel/apparmor_restrict_unprivileged_userns') !== '1' &&
    read('/proc/sys/kernel/unprivileged_userns_clone') !== '0'
  );
}

/** Processes of this user whose command line or environment names `root`. */
function processesUnder(root: string): string[] {
  const found: string[] = [];
  for (const pid of readdirSync('/proc').filter((name) => /^\d+$/.test(name))) {
    if (Number(pid) === process.pid) continue;
    try {
      const cmdline = readFileSync(`/proc/${pid}/cmdline`);
      if (cmdline.includes(root) || readFileSync(`/proc/${pid}/environ`).includes(root)) {
        found.push(`${pid} ${cmdline.toString().replaceAll('\0', ' ').trim().slice(0, 160)}`);
      }
    } catch {
      // Gone, or another user's.
    }
  }
  return found;
}

/** Waits for every process that names `root` to exit; kills and names those still running after 10 s. */
async function noneLeftUnder(root: string): Promise<void> {
  for (let i = 0; i < 50 && processesUnder(root).length; i++) await sleep(200);
  const left = processesUnder(root);
  if (!left.length) return;
  for (const line of left) {
    try {
      process.kill(Number(line.split(' ')[0]), 'SIGKILL');
    } catch {
      // Gone since.
    }
  }
  throw new Error(`still running after the app stopped: ${left.join('; ')}`);
}

/** A Secret Service on the app's own D-Bus session, unlocked as a login would unlock it. */
async function startKeyring(world: LocalWorld, env: NodeJS.ProcessEnv): Promise<Proc> {
  if (!env.DBUS_SESSION_BUS_ADDRESS) {
    throw new Error('vault "os" needs a D-Bus session: run the acceptance world under dbus-run-session');
  }
  const keyring = world.spawn(
    'gnome-keyring',
    'sh',
    [
      '-c',
      'printf "%s" "$KEYRING_PASSWORD" | exec gnome-keyring-daemon --foreground --replace --unlock --components=secrets',
    ],
    {
      env: { ...env, KEYRING_PASSWORD: 'acceptance-keyring' },
    },
  );
  // Ready when the Secret Service owns its name on the bus: the daemon prints no line for that.
  const deadline = Date.now() + 15_000;
  while (!secretServiceOnBus(env)) {
    if (keyring.exit) throw new Error(`the keyring exited before it served secrets; last lines:\n${keyring.tail(30)}`);
    if (Date.now() > deadline) {
      await keyring.stop();
      throw new Error(`the keyring did not serve secrets within 15 s; last lines:\n${keyring.tail(30)}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return keyring;
}

function secretServiceOnBus(env: NodeJS.ProcessEnv): boolean {
  const reply = spawnSync(
    'dbus-send',
    [
      '--session',
      '--print-reply',
      '--dest=org.freedesktop.DBus',
      '/org/freedesktop/DBus',
      'org.freedesktop.DBus.NameHasOwner',
      'string:org.freedesktop.secrets',
    ],
    { env, encoding: 'utf8' },
  );
  return reply.status === 0 && reply.stdout.includes('boolean true');
}
