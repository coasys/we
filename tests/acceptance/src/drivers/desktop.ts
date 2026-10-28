/**
 * The desktop driver: the desktop app's harness build, started on the run's X display inside the
 * run's D-Bus session, and driven through its harness link.
 *
 * A scenario reaches the app's windows only as a person would (`press`, `type`, `text`): through
 * the main window and the identity window, which runs every identity step in the custody service.
 * The harness build adds no command and no capability to the app; it reaches the windows through
 * WebKitGTK from the app's own process (`apps/we-tauri/src-tauri/src/harness.rs`).
 *
 * The vault (`vault`):
 * - `memory`, the default: the custody service keeps its items in memory, so the run leaves nothing
 *   in the session's keyring.
 * - `os`: the Secret Service, from a `gnome-keyring-daemon` the driver starts in the run's D-Bus
 *   session and unlocks, as a person's session is unlocked at login. On Linux the custody item is
 *   sealed under the passphrase the person types in the identity window either way: no OS prompt is
 *   shown, so there is nothing for the harness to answer.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

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

export class DesktopApp {
  private constructor(
    readonly name: string,
    readonly home: string,
    readonly dataPath: string,
    private readonly link: HarnessLink,
    private readonly proc: Proc,
    private readonly keyring: Proc | null,
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

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      XDG_DATA_HOME: join(home, '.local/share'),
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_CACHE_HOME: join(home, '.cache'),
      XDG_RUNTIME_DIR: runtime,
      DISPLAY: display.name,
      // Xvfb has no GPU: draw in software.
      WEBKIT_DISABLE_DMABUF_RENDERER: '1',
      WEBKIT_DISABLE_COMPOSITING_MODE: '1',
      LIBGL_ALWAYS_SOFTWARE: '1',
      WE_AD4M_DATA_PATH: dataPath,
      AD4M_IDENTITY_STORE_URL: world.storeUrl,
      AD4M_IDENTITY_STORE_KEYS: world.storeKey,
      COASYS_HARNESS_VAULT: vault,
    };

    let keyring: Proc | null = null;
    if (vault === 'os') keyring = await startKeyring(world, env);

    const link = await HarnessLink.listen();
    const proc = world.spawn(`desktop-${options.name}`, world.checkout.app, [], {
      cwd: world.checkout.testsJs,
      env: { ...env, COASYS_HARNESS_URL: link.url, COASYS_HARNESS_TOKEN: link.token },
    });
    const app = new DesktopApp(options.name, home, dataPath, link, proc, keyring);
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

  /** Waits until a script body answers something truthy, and answers that. */
  async waitFor<T = unknown>(window: WindowLabel, body: string, timeoutMs: number, what: string): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let last: unknown;
    while (Date.now() < deadline) {
      try {
        const value = await this.eval<T>(window, body, 30_000);
        if (value) return value;
        last = value;
      } catch (error) {
        last = error instanceof Error ? error.message : error;
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

  /** Presses the control with these words, once one is on screen and enabled. */
  async press(window: WindowLabel, words: string, timeoutMs = 30_000): Promise<void> {
    const body = `const [el] = h.controls(${JSON.stringify(words)}); if (!el || el.disabled || el.hasAttribute('disabled')) return false; return h.press(${JSON.stringify(words)});`;
    await this.waitFor(window, body, timeoutMs, `an enabled "${words}" in the ${window} window`);
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

  ipcLog(since = 0): Promise<IpcCall[]> {
    return this.link.send<IpcCall[]>('ipc.log', { since });
  }

  /** Connections to the harness link refused for a wrong token. */
  get refusedLinks(): number {
    return this.link.refused;
  }

  async stop(): Promise<void> {
    await this.link.close();
    await this.proc.stop();
    await this.keyring?.stop();
  }
}

/** A Secret Service in the run's D-Bus session, unlocked as a login would unlock it. */
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
  await keyring
    .waitFor(
      (l) => l.includes('GNOME_KEYRING_CONTROL') || l.includes('SSH_AUTH_SOCK') || l.includes('discover_other_daemon'),
      15_000,
      'the keyring',
    )
    .catch(() => undefined);
  return keyring;
}
