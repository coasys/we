/**
 * The harness: the desktop app driven by the acceptance world (`tests/acceptance/`), as the Tauri
 * app's `harness` feature drives that host (`apps/we-tauri/src-tauri/src/harness.rs`). The same
 * protocol and commands, so a scenario does not know which host it runs.
 *
 * Never in a shipped app, twice over: `electron-builder.config.js` leaves this file out of the
 * package, and `main.js` imports it only in a run that is not packaged and names a link. A packaged
 * app that somehow held the file still would not start it (`startHarness`). It adds no IPC channel
 * and nothing to a preload: it reaches the windows from the main process.
 *
 * At start the app reads `COASYS_HARNESS_URL` (`tcp://127.0.0.1:<port>`) and `COASYS_HARNESS_TOKEN`,
 * dials the harness link, and sends `{"hello":"we","token":…}`. An address that is not on the
 * loopback interface is refused here, before any connection. Each line after that is one JSON
 * command `{id, cmd, args}`; the app answers each with `{id, ok, result}` or `{id, ok: false, error}`:
 *
 * - `eval {window, js}`: runs `js` as the body of an async function in the window with that label
 *   (`main`, `identity`), in the page's own world, and answers what it returns, through JSON.
 * - `state`: the open windows (label and address) and the custody service's public state.
 * - `ipc.log {since}`: every invoke a window made since a time: when, which window, which channel.
 *   Never the arguments: a passphrase or a word goes through them.
 *
 * Two more settings, for the world the app runs in:
 *
 * - `COASYS_HARNESS_VAULT`: read by the custody sidecar, and only by its `harness` build
 *   (`crates/custody`): `memory`, the default, or `os`.
 * - `COASYS_HARNESS_HOLOCHAIN`: `on` starts the executor with Holochain; anything else without.
 */
import net from 'net';
import { createInterface } from 'readline';

/** The harness link's address `{host, port}`, null when none is set; throws for one off the loopback interface. */
export function linkAddress(env = process.env) {
  const url = env.COASYS_HARNESS_URL;
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`COASYS_HARNESS_URL ${url} is not an address`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const port = Number(parsed.port);
  if (parsed.protocol !== 'tcp:' || !port) throw new Error(`COASYS_HARNESS_URL ${url} is not tcp://<address>:<port>`);
  const loopback = (net.isIPv4(host) && host.startsWith('127.')) || (net.isIPv6(host) && host === '::1');
  if (!loopback) throw new Error(`COASYS_HARNESS_URL ${url} is not on the loopback interface: refused`);
  return { host, port };
}

/** The executor's Holochain arguments: what a release start passes with `on`, none running otherwise. */
export function holochainArgs(env = process.env) {
  return env.COASYS_HARNESS_HOLOCHAIN === 'on'
    ? ['--connect-holochain', 'true']
    : ['--run-holochain', 'false', '--connect-holochain', 'false'];
}

/**
 * Dials the harness link, when one is set and the app is not packaged, and answers its commands.
 * Wraps `ipcMain.handle` first, so call it before any handler is registered.
 *
 * `windows()` answers `{ main, identity }`, each a BrowserWindow or null; `custodyState()` the
 * custody service's public state. Answers the socket, or null when the harness does not start.
 */
export function startHarness({ app, ipcMain, windows, custodyState, env = process.env, connect = net.connect }) {
  if (app.isPackaged) return null;
  let address;
  try {
    address = linkAddress(env);
  } catch (error) {
    console.error(`[harness] ${error.message}`);
    return null;
  }
  if (!address) return null;

  const open = () => Object.entries(windows()).filter(([, win]) => win && !win.isDestroyed());
  const labelOf = (sender) => open().find(([, win]) => win.webContents === sender)?.[0] ?? 'other';

  const calls = [];
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) =>
    handle(channel, (event, ...args) => {
      calls.push({ at: Date.now(), window: labelOf(event.sender), command: channel });
      return handler(event, ...args);
    });

  const command = async (cmd, args) => {
    if (cmd === 'eval') {
      const win = open().find(([label]) => label === args?.window)?.[1];
      if (!win) throw new Error(`no window ${args?.window}`);
      if (typeof args.js !== 'string') throw new Error('eval: no js');
      // The value goes through JSON on the way out, so what comes back is a string.
      const code = `(async () => { const value = await (async () => {\n${args.js}\n})(); return JSON.stringify(value === undefined ? null : value); })()`;
      // A window that closes first never answers (a press on "Done" closes the identity window).
      const contents = win.webContents;
      let onGone;
      const gone = new Promise((_, reject) => {
        onGone = () => reject(new Error(`the window ${args.window} closed before the script answered`));
        contents.once('destroyed', onGone);
      });
      try {
        return JSON.parse(await Promise.race([contents.executeJavaScript(code, true), gone]));
      } finally {
        if (!contents.isDestroyed()) contents.removeListener('destroyed', onGone);
      }
    }
    if (cmd === 'state') {
      return {
        windows: open().map(([label, win]) => ({ label, url: win.webContents.getURL() })),
        custody: await custodyState(),
      };
    }
    if (cmd === 'ipc.log') {
      const since = Number(args?.since) || 0;
      return calls.filter((call) => call.at >= since);
    }
    throw new Error(`no harness command ${cmd}`);
  };

  const socket = connect(address.port, address.host);
  socket.on('error', (error) => console.error(`[harness] the link ended: ${error.message}`));
  socket.on('connect', () => {
    socket.write(`${JSON.stringify({ hello: 'we', token: env.COASYS_HARNESS_TOKEN ?? '', pid: process.pid })}\n`);
  });
  createInterface({ input: socket }).on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    // Each command on its own, so a script that waits does not hold up the others.
    command(message.cmd, message.args).then(
      (result) => socket.write(`${JSON.stringify({ id: message.id, ok: true, result: result ?? null })}\n`),
      (error) =>
        socket.write(`${JSON.stringify({ id: message.id, ok: false, error: String(error?.message ?? error) })}\n`),
    );
  });
  return socket;
}
