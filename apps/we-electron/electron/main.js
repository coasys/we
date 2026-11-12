import { spawn, spawnSync } from 'child_process';
import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net as electronNet,
  protocol,
  session as electronSession,
  shell,
  Tray,
} from 'electron';
import contextMenu from 'electron-context-menu';
import express from 'express';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import net from 'net';
import { homedir } from 'os';
import { basename, dirname, extname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { v4 as uuidv4 } from 'uuid';

import { createAccountRegistry, expandHome } from './accounts.js';
import { startCustody, superviseCustody } from './custodySidecar.js';
import { openExecutorLog } from './executorLog.js';
import {
  afterExecutorExit,
  crashBackoff,
  executorArgs,
  executorEnv,
  EXIT,
  initialExecutorConfig,
  outputClosed,
  outputTail,
  startWithPortRetry,
  stopChild,
  waitForExecutorReady,
} from './executorProcess.js';
import { createIdentity, IDENTITY_PAGE, IDENTITY_SCHEME, identityFile, isIdentityPage } from './identityWindow.js';
import { executorSpawnEnv, handleFromWindow, isFromWindow } from './ipcSender.js';
import {
  allowMediaPermission,
  isExternallyOpenable,
  isTrusted,
  MEDIA_PERMISSIONS,
  permissionOrigin,
  safeOrigin,
  trustedOrigins,
} from './navigationPolicy.js';
import { setupSeedServers } from './seed-servers.js';
import { closeHides, createTray, trayHostPresent } from './tray.js';

// Enable right-click context menu with inspect element in dev mode
contextMenu({
  showInspectElement: true,
  showSearchWithGoogle: false,
  showSaveImageAs: true,
  showCopyImage: true,
  showCopyImageAddress: true,
});

// The identity window's own scheme (see `identitySession`). Declared before `ready`, as Electron requires.
protocol.registerSchemesAsPrivileged([{ scheme: IDENTITY_SCHEME, privileges: { standard: true, secure: true } }]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow;
let ad4mPort = null;
let ad4mToken = null;
let executorProcess = null;
/** Set while an account switch is tearing the executor down on purpose. */
let switchingAccount = false;
/** How long to wait before starting again an executor that crashed. See `crashBackoff`. */
const executorBackoff = crashBackoff();
/** The current run's log in the account's data directory (see `executorLog.js`), or null. */
let executorLog = null;

/*
  This process's own console goes into the executor log too.

  What the host does around a start — the stale socket and LOCK files it removed, the path and binary
  it chose, the exit code and signal — is exactly what a crash report needs beside the executor's
  output, and none of it is the executor's to print. Copied rather than redirected, so the terminal
  in development is unchanged.
*/
for (const level of ['log', 'info', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    original(...args);
    executorLog?.host(level, ...args);
  };
}

/**
 * The seed's data path — the deployment default, and the account the registry seeds itself with.
 *
 * Generated into `seed-runtime.json` at build time because the main process needs it before any
 * window exists. Defaults to the launcher's own directory, so out of the box WE desktop, Flux and
 * ADAM share one agent. See `SeedConfig.ad4m`.
 */
function seedDataPath() {
  try {
    const runtime = JSON.parse(readFileSync(join(__dirname, 'seed-runtime.json'), 'utf8'));
    if (runtime.ad4mDataPath) return expandHome(runtime.ad4mDataPath);
  } catch {
    // Generated file missing or unreadable — fall through. Refusing to start over a config file
    // would be a worse failure than quietly using the location every install already uses.
  }
  return join(homedir(), '.ad4m');
}

/**
 * The executor binary to run in development, as `scripts/ad4m-executor.mjs` chose it when the
 * seed's runtime settings were generated: AD4M_EXECUTOR, the seed's own `executorPath`, or the
 * pinned commit's cached download.
 *
 * A packaged build has the binary copied in beside it and reads it from `resourcesPath`; an
 * unpackaged run has to find it outside the app. That path used to be hardcoded here, which meant
 * a seed pointing `executorPath` at a different checkout was silently ignored — the app went on
 * running whichever executor happened to be built next door, and every symptom of that appears
 * somewhere else entirely: a WS method that does not exist, a call that hangs, a feature that is
 * present in the code and absent at runtime.
 *
 * Falls back to a sibling ad4m checkout's build only when the generated settings are missing.
 */
function seedExecutorPath() {
  try {
    const runtime = JSON.parse(readFileSync(join(__dirname, 'seed-runtime.json'), 'utf8'));
    if (runtime.ad4mExecutorPath) return expandHome(runtime.ad4mExecutorPath);
  } catch {
    // Same reasoning as `seedDataPath`: a missing generated file is not worth refusing to start.
  }
  return join(__dirname, '..', '..', '..', '..', 'ad4m', 'target', 'release', 'ad4m-executor');
}

/*
  A seed that names its own product (`desktop.productName`) runs under that name, so its config
  directory — and the account registry in it — is its own rather than WE's. A packaged build already
  has the name from electron-builder; this is for a development run. Before `userData` is first read.
*/
const seedProductName = (() => {
  try {
    return JSON.parse(readFileSync(join(__dirname, 'seed-runtime.json'), 'utf8')).productName;
  } catch {
    return undefined;
  }
})();
if (seedProductName && !app.isPackaged) app.setName(seedProductName);

/*
  One instance per app. A second launch would start its own executor on the data path the first
  one's holds, which refuses to start (exit 79): a second window over a dead backend. The lock is
  per `userData` directory, and a seed product runs under its own name (above) and so its own
  directory: different products still run side by side. Taken before the registry and any executor work, and a refused launch exits at
  once: `app.quit()` would let the rest of this module run, and the registry migrates account
  directories when it is created.
*/
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  process.exit(0);
} else {
  // A second launch opens this one's window, hidden to the tray or not.
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    openMainWindow();
  });
}

// The registry needs the app's config directory, which is available before `ready`.
const accounts = createAccountRegistry({
  configDir: app.getPath('userData'),
  defaultPath: seedDataPath(),
});

/**
 * Where the executor keeps its data this launch.
 *
 * Precedence is env → the selected account → the seed default (via the registry, which seeds
 * itself from it). The env var wins outright and bypasses the registry: it is the ad-hoc override
 * for testing a first run against a throwaway directory, and having that quietly register itself
 * as a permanent account would be a surprise.
 */
function resolveAd4mDataPath() {
  const fromEnv = process.env.WE_AD4M_DATA_PATH;
  if (fromEnv) return expandHome(fromEnv);
  // Before resolving, clear out any account whose setup was abandoned last session — it has a
  // directory and a placeholder name and no identity, and nothing else will ever tidy it up.
  accounts.pruneAbandoned();
  return accounts.resolveActivePath();
}

/**
 * Scaffold the data directory if the executor has never run against it.
 *
 * `ad4m-executor run` does NOT initialise — `init` is a separate subcommand, and Run's code path
 * never calls it. Until now that was invisible: the path was hardcoded to `~/.ad4m`, which the
 * launcher had almost always already initialised. Making the path configurable makes an
 * uninitialised directory easy to reach, and an executor started against one comes up without its
 * bootstrap seed rather than failing loudly.
 *
 * Tauri does not need this — its lib.rs calls `rust_executor::init::init` directly before running.
 *
 * `mainnet_seed.seed` is the marker because it is what `init` writes for the executor to consume
 * at runtime; a directory holding it has been through initialisation.
 *
 * Its output is captured and written to the terminal and the log both, rather than inherited: a
 * first run is the one most worth having a record of, and inherited output reaches only a terminal.
 */
function ensureDataPathInitialised(executorPath, dataPath, log) {
  if (existsSync(join(dataPath, 'mainnet_seed.seed'))) return;

  console.log('[main] Data path not initialised, running executor init:', dataPath);
  const result = spawnSync(executorPath, ['init', '--data-path', dataPath], { maxBuffer: 16 * 1024 * 1024 });
  for (const [output, destination] of [
    [result.stdout, process.stdout],
    [result.stderr, process.stderr],
  ]) {
    if (!output?.length) continue;
    destination.write(output);
    log?.write(output);
  }

  if (result.error || result.status !== 0) {
    // Surfaced rather than thrown: the executor may still start, and a hard failure here would
    // turn a recoverable state into an app that will not open at all.
    const reason = result.error?.message ?? `exit code ${result.status ?? result.signal}`;
    console.error('[main] Executor init failed — the executor may not start correctly:', reason);
    return;
  }
  console.log('[main] Executor init complete');
}

// Find a free port in the given range
function findFreePort(startPort, endPort) {
  return new Promise((resolve, reject) => {
    let port = startPort;

    function tryPort(p) {
      if (p > endPort) {
        reject(new Error('No free ports available'));
        return;
      }

      const server = net.createServer();
      server.listen(p, '127.0.0.1', () => {
        server.once('close', () => {
          resolve(p);
        });
        server.close();
      });

      server.on('error', () => {
        tryPort(p + 1);
      });
    }

    tryPort(port);
  });
}

/**
 * Start the AD4M executor, supervised by its run contract (`executorProcess.js`, `EXIT`).
 *
 * `samePort` starts it again with the same arguments — port and credential included — which is
 * what `runtime.restart` (exit 75) asks for. Otherwise it gets a free port and a new credential.
 *
 * The first start, before the window exists, tries another port when its executor exits 80 (the
 * port was taken between choosing it and binding it), up to three times; after that the exit
 * handler owns every recovery (`startWithPortRetry`). One that exits 78 or 79 throws, with the
 * executor's last lines as the reason.
 */
function startExecutor({ samePort = false } = {}) {
  return startWithPortRetry(startExecutorOnce, { samePort, appUp: () => Boolean(mainWindow) });
}

/** The config file `--config` names, in the account's data folder. See `ensureExecutorConfig`. */
const executorConfigFile = (dataPath) => join(dataPath, 'executor-config.json');

/**
 * Create the executor's config file the first time this app starts an executor on a data folder,
 * from what an older build kept in the account registry (`initialExecutorConfig`). An existing file
 * is the person's and is never rewritten here; the executor writes it (`runtime.setConfig`).
 */
function ensureExecutorConfig(dataPath) {
  const file = executorConfigFile(dataPath);
  if (existsSync(file)) return file;
  mkdirSync(dataPath, { recursive: true });
  writeFileSync(file, `${JSON.stringify(initialExecutorConfig(accounts.executorSettings()), null, 2)}\n`, {
    mode: 0o600,
  });
  console.log('[main] Created the executor config file:', file);
  return file;
}

async function startExecutorOnce({ samePort }) {
  try {
    if (!samePort || !ad4mPort) {
      ad4mPort = await findFreePort(12000, 13000);
      ad4mToken = uuidv4();
    }

    // Get AD4M data directory
    const ad4mDataPath = resolveAd4mDataPath();

    // Start this run's log before anything below touches the data directory, so the cleanup it
    // does is on record. The previous run's file is closed first: rotation renames it, and on
    // Windows an open file cannot be renamed. Output still arriving from a killed executor goes to
    // the log it was started with, which is closed, so it cannot land in this run's file.
    executorLog?.close();
    executorLog = openExecutorLog(ad4mDataPath);
    const log = executorLog;
    if (log) console.log('[main] Executor log:', log.path);

    // Nothing else running on this data folder is stopped, and nothing under it is deleted: an
    // executor someone else runs there keeps it, and this one refuses to start (exit 79). See the
    // head of `executorProcess.js`.

    console.log('Starting AD4M executor...');
    console.log('Port:', ad4mPort);
    console.log('Data path:', ad4mDataPath);

    // Path to the executor binary
    // In production, this will be bundled with the app
    // In development, we need to point to the built executor from ad4m repo
    const executorPath = app.isPackaged ? join(process.resourcesPath, 'ad4m-executor') : seedExecutorPath();

    console.log('Executor path:', executorPath);

    ensureDataPathInitialised(executorPath, ad4mDataPath, log);
    const configFile = ensureExecutorConfig(ad4mDataPath);

    // stdin is a pipe this process holds open and never writes: with `--watch-stdin true` the
    // executor stops when it closes, which `stopExecutorProcess` does, and the OS does if this
    // process dies. Its output is still captured: Holochain and language output reach stdout.
    executorProcess = spawn(
      executorPath,
      executorArgs({ port: ad4mPort, dataPath: ad4mDataPath, configFile, logDir: join(ad4mDataPath, 'logs') }),
      {
        detached: true, // Create a new process group so we can kill the entire tree
        stdio: ['pipe', 'pipe', 'pipe'],
        env: executorSpawnEnv(executorEnv(), ad4mToken),
      },
    );

    // Detach from the parent — lets Node.js exit without waiting for the child,
    // and is required for process.kill(-pid) group-kill to work.
    executorProcess.unref();
    const startedAt = Date.now();
    // Also unref the stdio streams — without this, the pipes keep Electron's event loop alive
    // after the executor is killed, causing a second Ctrl+C to be needed to return to the prompt.
    executorProcess.stdin?.unref?.();
    executorProcess.stdout?.unref();
    executorProcess.stderr?.unref();
    // A write to a pipe whose reader is gone; nothing is written, so only the close can fail.
    executorProcess.stdin?.on('error', () => {});

    // The last lines it printed: the reason a refused start (78, 79) gives is on stderr.
    const tail = outputTail(20);
    // Forward executor output to the console (which also prevents EPIPE errors) and to this run's
    // log. `log`, not `executorLog`: after a restart the latter is the next run's file.
    executorProcess.stdout?.on('data', (data) => {
      process.stdout.write(data);
      log?.write(data);
      tail.push(data);
    });

    executorProcess.stderr?.on('data', (data) => {
      process.stderr.write(data);
      log?.write(data);
      tail.push(data);
    });

    executorProcess.on('error', (err) => {
      console.error('Failed to start executor:', err);
    });

    const proc = executorProcess;
    // The reason a refused start gives can arrive after `exit`: read the tail once it is all in.
    const outputDone = outputClosed(proc);
    executorProcess.on('exit', (code, signal) => {
      // `stopExecutor` clears `executorProcess` before it stops it, so an executor this app stopped
      // (quit, account switch, settings) is no longer the current one. Not before the window
      // exists: the first start is still waiting on this executor and reads its code itself.
      const outcome = afterExecutorExit(
        {
          current: executorProcess === proc,
          quitting: executorStoppedForQuit,
          appUp: Boolean(mainWindow),
          startedAt,
          code,
          signal,
        },
        executorBackoff,
      );
      // Stopped on purpose for a restart or an account switch: expected, nothing to report.
      if (outcome.action === 'stopped' && switchingAccount) return;

      const msg = `[main] Executor exited — code: ${code}, signal: ${signal}`;
      console.log(msg);
      if (outcome.action !== 'stopped' && outcome.action !== 'leave') executorProcess = null;
      if (outcome.action === 'restart') {
        console.log(
          outcome.samePort
            ? '[main] The executor asked to be restarted; starting it again with the same arguments'
            : `[main] Starting the executor again in ${outcome.delayMs} ms`,
        );
        void restartExecutorAndReload({ samePort: outcome.samePort, delayMs: outcome.delayMs });
        return;
      }
      // `done` too: the app clears `executorProcess` before it stops the executor itself, so an exit 0
      // that reaches here was asked for elsewhere (`runtime.quit`, a signal), and nothing starts it again.
      if (['refused', 'busy', 'give-up', 'done'].includes(outcome.action)) {
        void outputDone().then(() => showExecutorStopped(outcome.action, tail.lines(), configFile, ad4mDataPath));
      }
      // Gone for good: the sidecar would only keep restarting against a dead port.
      if (outcome.action !== 'stopped' && outcome.action !== 'leave') void stopCustody();
      // Notify the renderer so it shows in DevTools even in packaged builds.
      //
      // `mainWindow?.` only guards against null, not against a *destroyed* window: on quit the
      // reference survives its BrowserWindow, and killing the executor makes this handler fire
      // right afterwards — reaching webContents then throws "Object has been destroyed" as an
      // uncaught exception, on the way out, where it looks like a crash.
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.executeJavaScript(`console.error(${JSON.stringify(msg)})`).catch(() => {});
    });

    console.log('AD4M executor process started, waiting for it to be ready...');

    // Ready is its /health answering ok, not just the TCP port open (`waitForExecutorReady`).
    try {
      await waitForExecutorReady(ad4mPort, { gone: () => proc.exitCode !== null || proc.signalCode !== null });
      console.log(`The executor on port ${ad4mPort} is ready`);
    } catch (err) {
      if (proc.exitCode !== null) await outputDone();
      const reason = startRefusal(proc.exitCode, tail.lines(), configFile, ad4mDataPath);
      if (reason) throw Object.assign(new Error(reason), { exitCode: proc.exitCode });
      if (proc.exitCode === EXIT.PORT_TAKEN) err.exitCode = EXIT.PORT_TAKEN;
      throw err;
    }

    console.log('AD4M executor ready');
    startCustodyFor(ad4mPort, ad4mToken);
  } catch (error) {
    console.error('Error starting executor:', error);
    throw error;
  }
}

/**
 * Why the executor refused to start, in words for the person, or null when it did not refuse:
 * exit 78 (its config file or a flag) and 79 (another executor holds the data folder). Restarting
 * does not help either, so the app says so rather than trying again.
 */
function startRefusal(code, lines, configFile, dataPath) {
  const last = lines.length ? `\n\n${lines.slice(-8).join('\n')}` : '';
  if (code === EXIT.CONFIG_REFUSED)
    return `The executor refused its settings. Fix the config file and start the app again:\n${configFile}${last}`;
  if (code === EXIT.DATA_FOLDER_BUSY)
    return `Another AD4M executor is using this data folder:\n${dataPath}\n\nQuit the app that runs it (the ADAM launcher, another copy of this app), then start this one again.${last}`;
  return null;
}

/** Tell the person the executor stopped and will not be started again, and why. */
function showExecutorStopped(action, lines, configFile, dataPath) {
  const code = { refused: EXIT.CONFIG_REFUSED, busy: EXIT.DATA_FOLDER_BUSY }[action];
  const last = lines.length ? `\n\n${lines.slice(-8).join('\n')}` : '';
  const why =
    action === 'done'
      ? 'It was stopped outside the app, so the app does not start it again.'
      : 'It keeps stopping, so the app does not start it again.';
  const detail =
    startRefusal(code, lines, configFile, dataPath) ??
    `${why} Quit and start the app to try again.${last}\n\nThe executor's log: ${join(dataPath, 'logs', 'executor-0.log')}`;
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  void dialog.showMessageBox(parent, { type: 'error', message: 'The AD4M executor stopped', detail });
}

/** The renderer bundle: copied beside the app when packaged, built into `dist` otherwise. */
const rendererDir = () => (app.isPackaged ? join(process.resourcesPath, 'app', 'dist') : join(__dirname, '..', 'dist'));

// ── Identity ─────────────────────────────────────────────────────────────────────────────────────────
// The person's master key is kept by the custody sidecar (`custodySidecar.js`), never by the executor
// or a web page. Only the identity window runs a flow; the main window may open it on a step and
// read public custody state. The crate has no Windows support, so there identity is off.

/** The custody sidecar while it runs, started again if it stops on its own; else null. */
let custodySupervisor = null;
const custody = () => custodySupervisor?.current() ?? null;

/** The `we-custody` binary: beside the executor when packaged, the crate's release build otherwise. */
const custodyBinary = () =>
  app.isPackaged
    ? join(process.resourcesPath, 'we-custody')
    : join(__dirname, '..', '..', '..', 'crates', 'custody', 'target', 'release', 'we-custody');

/** Starts the sidecar against the executor on `port`, whose admin credential is `credential`. */
function startCustodyFor(port, credential) {
  if (process.platform === 'win32') return;
  const binary = custodyBinary();
  if (!existsSync(binary)) {
    console.error(
      '[main] No custody sidecar at',
      binary,
      '— identity is off. Build it: cargo build --release in crates/custody',
    );
    return;
  }
  // A new supervisor per executor start, so the restarts it allows are counted afresh.
  custodySupervisor = superviseCustody({
    start: ({ onExit }) => startCustody({ binary, executorPort: port, credential, onExit }),
  });
}

/** Closes the identity window and stops the sidecar: its step cannot outlive the executor it runs against. */
async function stopCustody() {
  identity.window()?.close();
  const supervisor = custodySupervisor;
  custodySupervisor = null;
  await supervisor?.stop();
}

const identity = createIdentity({ custody, openWindow: openIdentityWindow });

/**
 * The identity window's session: in memory, its own, so it shares no storage, cookies or
 * permissions with the app. Its page is served on its own scheme from the built bundle, never from
 * the app's server or a dev server. It may write the clipboard (the offer link) and nothing else.
 */
let identitySessionMade = null;
function identitySession() {
  if (identitySessionMade) return identitySessionMade;
  const own = electronSession.fromPartition('identity');
  const dir = join(rendererDir(), 'identity');
  own.protocol.handle(IDENTITY_SCHEME, (request) => {
    const file = identityFile(request.url, dir);
    if (!file || !existsSync(file)) return new globalThis.Response('Not found', { status: 404 });
    return electronNet.fetch(pathToFileURL(file).toString());
  });
  const mayUse = (permission) => permission === 'clipboard-sanitized-write';
  own.setPermissionRequestHandler((_contents, permission, callback) => callback(mayUse(permission)));
  own.setPermissionCheckHandler((_contents, permission) => mayUse(permission));
  identitySessionMade = own;
  return own;
}

function openIdentityWindow({ onClosed }) {
  const win = new BrowserWindow({
    // The app's own name, whichever build this is (WE, or a white-labelled one); the page names none.
    title: `${app.getName()} — your identity`,
    icon: windowIcon(),
    width: 480,
    height: 640,
    resizable: false,
    center: true,
    webPreferences: {
      preload: join(__dirname, 'identityPreload.js'),
      session: identitySession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      // A packaged build has no inspector here: it would show the words to anything that opens it.
      devTools: !app.isPackaged,
    },
  });
  win.removeMenu();
  // Keep the title above: the page's own is generic, and would replace the app's name on load.
  win.on('page-title-updated', (event) => event.preventDefault());
  // Its own page only: no link, script or redirect takes it anywhere else, and it opens no window.
  const stay = (event, url) => {
    if (!isIdentityPage(event.url ?? url)) event.preventDefault();
  };
  win.webContents.on('will-navigate', stay);
  win.webContents.on('will-redirect', stay);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.on('closed', onClosed);
  win.loadURL(IDENTITY_PAGE);
  return win;
}

// Start HTTP servers to serve bundled apps (production only)
function startAppServer() {
  console.log('🚀 Starting application servers...\n');

  // Setup seed-based app servers (Flux, Playground, etc.)
  setupSeedServers();

  // Setup launcher (WE app itself) on port 9080
  const launcherDir = rendererDir();

  if (existsSync(launcherDir)) {
    console.log('📦 Starting WE launcher server on http://localhost:9080');
    console.log('   Serving from:', launcherDir);

    const launcherApp = express();

    launcherApp.use(
      express.static(launcherDir, {
        setHeaders: (res) => {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        },
      }),
    );

    /*
      `root` rather than an absolute path. Without one, `send` checks every segment of the path for
      a dotfile and answers 404 — and a running AppImage is mounted under `/tmp/.mount_WE-…`, so
      every deep link (a reload anywhere but `/`) came back "Not Found". With `root`, only the part
      below it is checked, which is how `express.static` above already behaves.
    */
    launcherApp.use((req, res) => {
      res.sendFile('index.html', { root: launcherDir });
    });

    launcherApp.listen(9080, () => {
      console.log('   ✓ WE launcher listening on port 9080\n');
    });
  } else {
    console.warn('⚠️  WE launcher directory not found at:', launcherDir);
  }
}

/**
 * What `navigationPolicy` needs to work out the trusted set: where the app is served from, and the
 * ports the build assigned the seed's embedded apps.
 *
 * `readFileSync` rather than a JSON import, to match how `seedDataPath` already reads its generated
 * runtime file and to avoid depending on import-attribute support in whichever Node the packaged
 * Electron carries. A failed read yields an empty map — fewer trusted origins, never more.
 */
function policyOptions() {
  let seedPorts = {};
  try {
    seedPorts = JSON.parse(readFileSync(join(__dirname, 'seed-port-map.json'), 'utf8'));
  } catch {
    // No port map means no embedded apps to trust, which is the safe reading.
  }
  return { appUrl: appUrl(), seedPorts };
}

const trusted = (url) => isTrusted(url, trustedOrigins(policyOptions()));

/**
 * The window's own icon, which on Linux is what a taskbar or dock actually shows.
 *
 * Packaging an icon (electron-builder's `icon`) writes the .desktop entry and the hicolor theme
 * inside the AppImage, and neither reaches a running window: a desktop environment matches a window
 * to a .desktop entry by WM_CLASS, and an AppImage installs no .desktop entry unless the user asks
 * for one. So the panel had nothing to match and fell back to a generic square. Electron sets
 * `_NET_WM_ICON` from this option and nothing else — which is why the Tauri build, whose config
 * lists its icons, was showing the mark while this one was not.
 *
 * The file therefore has to exist at runtime rather than only at package time; it is copied to
 * `resources/icon.png` by `extraResources`, alongside the executor and the renderer bundle — the
 * seed's own icon when it has one, as the package's is.
 */
const windowIcon = () => {
  if (app.isPackaged) return join(process.resourcesPath, 'icon.png');
  // Unpackaged: another seed's icon where `@we/brand` has rendered it (see seed-runtime.json),
  // else WE's own.
  try {
    const runtime = JSON.parse(readFileSync(join(__dirname, 'seed-runtime.json'), 'utf8'));
    if (runtime.windowIcon) return runtime.windowIcon;
  } catch {
    // No generated config: WE's own icon.
  }
  return join(__dirname, '..', 'build', 'icon.png');
};

function createWindow() {
  mainWindow = new BrowserWindow({
    show: false, // Don't show until ready
    icon: windowIcon(),
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      /*
        Was `false`, "to allow cross-origin access for screen sharing in iframes".

        That setting turns off the same-origin policy for the entire renderer, frames included. WE
        renders `we-iframe` from post content — an EmbedBlock's URL, a video embed — so every page
        anyone had ever linked in a post was running beside the app with no origin boundary at all:
        able to read `parent.document`, to fetch `localhost:12000` with the executor's credentials,
        and to read the responses. It made the app-bridge origin checks decorative, since a hostile
        embed never needed to ask.

        It also was not what screen sharing needed. `getDisplayMedia` in a subframe is gated by the
        iframe's `allow="display-capture"` and, in Electron, by the display-media handler installed
        below — neither of which has anything to do with the same-origin policy.
      */
      webSecurity: true,
    },
  });

  hideOnClose(mainWindow);

  // Show window only when content is ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  const session = mainWindow.webContents.session;

  /*
    Screen capture, through the mechanism that exists for it.

    Electron will not satisfy `getDisplayMedia` without this handler, and the handler is where the
    choice of what to share is actually made. `useSystemPicker` asks the OS to draw its own picker
    where one exists (macOS 15+, Wayland portals), which is the right answer when it is available:
    the source list never enters the renderer, so a page cannot enumerate the user's open windows
    just by asking to share.
  */
  session.setDisplayMediaRequestHandler(
    async (request, callback) => {
      /*
        This handler runs only where the OS has no picker of its own.

        `useSystemPicker` stays on, and stays first: where the OS draws the picker — macOS 15+, a
        Wayland portal — the source list never enters the renderer at all, so a page cannot
        enumerate somebody's open windows just by asking to share. That is worth keeping, and it is
        also what makes the branch below correct by construction rather than by guessing the
        platform: Electron does not call this handler when the system picker is used, so anything
        reaching here is a machine with no picker, and the choice has to come from somewhere else.

        Where that somewhere else used to be `sources[0]` — the first screen, chosen by nobody. On a
        two-monitor Linux desktop that is a coin toss, and a share of the wrong screen is not a
        mistake you can see from the sharing side.
      */
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          // Small enough to send several over IPC, large enough to tell two windows apart.
          thumbnailSize: { width: 320, height: 180 },
        });
        if (!sources.length) return callback({});
        // Nothing to choose between. Asking would be a dialog whose only answer is the one it was
        // opened with.
        if (sources.length === 1) return callback({ video: sources[0], audio: 'loopback' });

        const chosenId = await askRendererForScreenSource(mainWindow, sources);
        const chosen = sources.find((source) => source.id === chosenId);
        // An empty answer is somebody closing the picker, which is an answer and not a failure —
        // `{}` is how this API spells it, and the renderer reads it back as 'cancelled'.
        callback(chosen ? { video: chosen, audio: 'loopback' } : {});
      } catch {
        callback({});
      }
    },
    { useSystemPicker: true },
  );

  /*
    Camera, microphone and screen capture — for the app and its embedded apps, not for a page
    somebody linked in a post.

    The decision and its reasoning live in `navigationPolicy.js`, where they are tested. What is
    here is the wiring, and one thing the wiring owes: **a refusal says so.** Electron consults these
    handlers silently, and the app's own error path for a denied camera is a fallback to audio-only
    — so a wrong answer here surfaced as "no video, no errors", which is a bug report nobody can act
    on. It is exactly the shape this audit spent its P2 section removing.
  */
  const decideMedia = (permission, details, webContentsUrl) => {
    const origin = permissionOrigin(details, webContentsUrl);
    const allowed = allowMediaPermission({
      permission,
      origin,
      isMainFrame: details?.isMainFrame,
      origins: trustedOrigins(policyOptions()),
    });
    if (!allowed && MEDIA_PERMISSIONS.includes(permission)) {
      console.warn(`[we] refused ${permission} to ${origin ?? 'a frame with no identifiable origin'}`);
    }
    return allowed;
  };

  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(decideMedia(permission, details, webContents?.getURL()));
  });

  session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    return decideMedia(permission, { requestingUrl: requestingOrigin, ...details }, webContents?.getURL());
  });

  /*
    A link that opens a window opens it in the user's browser instead.

    `window.open` and `target="_blank"` otherwise create a new BrowserWindow with *these*
    webPreferences — the preload attached, the IPC channels live — showing a page WE did not write.
    A template or a post is enough to trigger it. Denying and handing the URL to the OS is both
    safer and what the user expects a link to do.
  */
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternallyOpenable(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  /*
    The top frame stays on the app.

    Without this, anything that can set `location` — a template, an embedded app reaching `top` —
    could navigate the main window to a page of its choosing, which would then be running *as* the
    app: same window, same preload, same IPC. Nothing in WE navigates the top frame away, so this
    forbids the whole class rather than trying to judge each case.
  */
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (trusted(url)) return;
    event.preventDefault();
    if (isExternallyOpenable(url)) shell.openExternal(url);
  });

  // `<webview>` is a second renderer with its own settings and no reason to exist here.
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());

  /*
    The app's trace lines (`we:trace …`, see `installConsoleTrace`) go into the executor log too, so
    an auto-processor pass reads beside the executor output that ran it. Only those lines: the rest
    of the renderer's console stays in its devtools.
  */
  mainWindow.webContents.on('console-message', ({ message }) => {
    if (message.startsWith('we:trace ')) executorLog?.host('log', message);
  });

  installContentSecurityPolicy(session);

  mainWindow.loadURL(appUrl());
}

/**
 * Attach the Content-Security-Policy to WE's own documents.
 *
 * The policy itself lives in `navigationPolicy.js`, where it is tested. What is decided here is
 * *which responses get it*: only WE's own main-frame documents.
 *
 * A CSP header governs the document it arrives on and everything that document loads, so setting it
 * on every response in the session would impose WE's policy on Flux's page too — a policy written
 * for a different app, breaking it in ways nobody would think to attribute to this file. An
 * embedded app's own security headers stay its own.
 */
function installContentSecurityPolicy(session) {
  const policy = contentSecurityPolicy(Boolean(process.env.VITE_DEV_SERVER_URL));
  const appOrigin = safeOrigin(appUrl());

  session.webRequest.onHeadersReceived((details, callback) => {
    const isOwnDocument = details.resourceType === 'mainFrame' && safeOrigin(details.url) === appOrigin;
    if (!isOwnDocument) return callback({ responseHeaders: details.responseHeaders });

    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] } });
  });
}

/**
 * The policy, as `@we/csp` built it at prebuild time into `seed-csp.json`.
 *
 * Read from a generated file rather than imported because the packaged main process holds only
 * `electron/` and `dist/` — a workspace package is not there to import. The policy depends on nothing
 * known only at runtime (the app's own origins are all localhost, which it allows already), so
 * building it ahead of time loses nothing.
 *
 * A missing file is a thrown error, not a missing policy: an app that silently ran without one is the
 * failure this exists to prevent.
 */
function contentSecurityPolicy(dev) {
  const file = join(__dirname, 'seed-csp.json');
  if (!existsSync(file)) {
    throw new Error('[we] electron/seed-csp.json is missing — run scripts/generate-seed-config.cjs before starting.');
  }
  const policies = JSON.parse(readFileSync(file, 'utf8'));
  return dev ? policies.development : policies.production;
}

/**
 * Where the app is served from. Vite in development; the bundled express server in production,
 * over HTTP rather than file:// so it shares a protocol with the app iframes.
 */
function appUrl() {
  return process.env.VITE_DEV_SERVER_URL || 'http://localhost:9080';
}

/**
 * Every invoke handler answers the main window's own top frame on the app's origin, and nothing else
 * — see `ipcSender.js`. `get-token` is the executor's admin credential, so this is not optional.
 */
const isAppUrl = (url) => safeOrigin(url) !== null && safeOrigin(url) === safeOrigin(appUrl());
const handle = (channel, handler) => handleFromWindow(ipcMain, () => mainWindow, isAppUrl, channel, handler);

// IPC handlers for AD4M connection details
handle('get-port', () => {
  return ad4mPort;
});

handle('get-token', () => {
  return ad4mToken;
});

handle('get-is-development', () => {
  return !!process.env.VITE_DEV_SERVER_URL;
});

/**
 * The server link language bundle built in the seed's ad4m checkout, in a development run only.
 *
 * Absolute, because the executor reads it from disk when publishing. Null in a packaged build,
 * with no `repoPath`, or when the language has not been built — `pnpm build` in
 * `bootstrap-languages/server-link-language` of the ad4m repo produces it.
 *
 * Returns a copy with one comment line appended, not the build itself. A language's address is
 * the hash of its bundle, and the language store keeps the first meta published under an address:
 * a later publish of identical bytes is ignored and hands back the earlier meta. A build that was
 * ever published by hand with different template parameters is therefore stuck with them. The
 * marker gives WE development its own address, the same one for everyone on the same build.
 */
handle('get-dev-link-language-bundle', () => {
  if (app.isPackaged || !process.env.VITE_DEV_SERVER_URL) return null;
  try {
    const runtime = JSON.parse(readFileSync(join(__dirname, 'seed-runtime.json'), 'utf8'));
    if (!runtime.ad4mRepoPath) return null;
    const bundle = join(
      expandHome(runtime.ad4mRepoPath),
      'bootstrap-languages',
      'server-link-language',
      'build',
      'bundle.js',
    );
    if (!existsSync(bundle)) return null;
    const copy = join(app.getPath('temp'), 'we-dev-server-link-language', 'bundle.js');
    mkdirSync(dirname(copy), { recursive: true });
    writeFileSync(copy, `${readFileSync(bundle, 'utf8')}\n// Published for WE development.\n`);
    return copy;
  } catch {
    return null;
  }
});

// ── Identity channels ────────────────────────────────────────────────────────
// The main window may open the identity window on a step (answered with how the step ended, never a
// screen) and read public custody state. Only the identity window runs the flow.

handle('identity-open', (_event, step) => identity.open(step));
handle('identity-public-state', () => identity.publicState());

const handleIdentity = (channel, handler) =>
  handleFromWindow(ipcMain, () => identity.window(), isIdentityPage, channel, handler);

handleIdentity('identity-flow-start', () => identity.start());
handleIdentity('identity-flow-step', (_event, input) => identity.step(input));
handleIdentity('identity-flow-cancel', () => identity.cancel());
handleIdentity('identity-flow-finish', () => identity.finish());

// ── Account management ───────────────────────────────────────────────────────
// Every mutation is registry-only; nothing takes effect until the app relaunches, because the
// executor is configured with one data path at startup and holds it for its lifetime.

handle('accounts-list', () => accounts.list());
handle('accounts-create', () => accounts.create());
handle('accounts-display', (_event, id, display) => accounts.setDisplay(id, display));
handle('accounts-select', (_event, id) => accounts.select(id));
handle('accounts-remove', (_event, id) => accounts.remove(id));

// ── Which device serves the account ──────────────────────────────────────────
// The signed-in account's servers, kept on its registry entry. The renderer logs in to a server with
// this computer's device key before adding it, and reloads after choosing one: the connector reads
// the choice at start, so nothing here touches the executor.

handle('servers-list', () => accounts.servers());
handle('servers-add', (_event, server) => accounts.addServer(server));
handle('servers-remove', (_event, address) => accounts.removeServer(address));
handle('servers-choose', (_event, address) => accounts.chooseServer(address ?? null));

/**
 * Make the newly selected account take effect.
 *
 * The executor binds one data path for its lifetime, so the old one has to go — but only the
 * *executor*, not the app. Electron spawns it as a child process, so it can be killed and
 * respawned against the new path while the window stays put; relaunching the whole app (which is
 * what this used to do, and what the ADAM launcher does) closes and reopens the window for no
 * reason beyond it being the easier thing to write.
 *
 * The renderer is reloaded rather than reset in place. Every store holds agent-scoped state —
 * session, datasets, spaces, profiles, presence, themes, templates, the editor — and clearing them
 * individually means any one that forgets leaks the previous account's data into the next session.
 * That is a privacy bug, not a glitch. A reload is a guaranteed clean slate and costs a few
 * hundred milliseconds, which is why it is the design rather than a shortcut.
 *
 * Tauri cannot do this: it runs the executor in-process, and the executor's own graceful shutdown
 * ends in `std::process::exit`, so stopping it takes the app with it. That host still relaunches.
 */
handle('accounts-apply', () => restartExecutorAndReload());

/**
 * Start the executor over, with a new port and credential, and reload the window.
 *
 * The same act as applying an account selection. The settings page restarts the executor through
 * `runtime.restart` instead (exit 75: the same arguments); this one remains for a host restart the
 * executor cannot be asked for. Sharing the implementation is not a shortcut: two functions that
 * both mean "start the executor over" would drift, and the second one to be written would be the
 * one that forgets to repaint the window.
 */
handle('executor-restart', () => restartExecutorAndReload());

/**
 * A path on this machine, for the backend to write to or read from.
 *
 * The executor's export and import take a path on its own filesystem, and it runs here — so this is
 * the one place that can turn "somewhere to put it" into something it can use. A renderer file
 * picker cannot: the File it yields carries no path.
 */
/*
  Save a file the renderer has produced — every download in the app, when running here.

  The renderer's own ways out are both worse on a desktop: a download link drops the file in
  Downloads with no say and no answer, and Chromium's save picker needs a file-system permission
  this app refuses to every page (see the permission handlers). So the dialog is the main process's
  own, and so is the write — to the path that dialog returned and nothing else, which is what keeps
  an IPC channel that writes files from being one that writes *any* file.

  Resolves true once written, false when the dialog was closed.
*/
handle('save-file', async (_event, { name, bytes } = {}) => {
  if (typeof name !== 'string' || !(bytes instanceof Uint8Array))
    throw new Error('save-file: a name and bytes are required');
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  // A name only — a renderer-supplied path would choose the folder for the reader.
  const fileName = basename(name) || 'download';
  const extension = extname(fileName).slice(1);
  const result = await dialog.showSaveDialog(parent, {
    defaultPath: join(app.getPath('downloads'), fileName),
    filters: extension
      ? [
          { name: extension.toUpperCase(), extensions: [extension] },
          { name: 'All files', extensions: ['*'] },
        ]
      : [],
  });
  if (result.canceled || !result.filePath) return false;
  writeFileSync(result.filePath, bytes);
  return true;
});

handle('executor-choose-file', async (_event, { save, defaultName } = {}) => {
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const options = { defaultPath: defaultName, filters: [{ name: 'JSON', extensions: ['json'] }] };
  const result = save
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showOpenDialog(parent, { ...options, properties: ['openFile'] });
  if (result.canceled) return null;
  return save ? (result.filePath ?? null) : (result.filePaths[0] ?? null);
});

/*
  Restarts run one after another. Two at once — a crash restart and a settings restart or an
  account switch — would each stop and start the executor, and the one whose executor was replaced
  waits out the readiness check on a dead port, then reloads the window a minute later and clears
  `switchingAccount` under the other. Queued rather than joined, so a switch made during a restart
  still gets its own: the executor reads the selected account when it starts.
*/
let restartChain = Promise.resolve();
/** Restarts waiting in `restartChain` behind the one running. */
let restartsQueued = 0;
function restartExecutorAndReload({ samePort = false, delayMs = 0 } = {}) {
  restartsQueued += 1;
  restartChain = restartChain
    .catch(() => {})
    .then(async () => {
      // The crash backoff waits here, inside the chain, so a start failing meanwhile sees this
      // restart queued and leaves the reload to it.
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      restartsQueued -= 1;
      // Quit while it waited: nothing to start.
      if (executorStoppedForQuit) return;
      return restartExecutorAndReloadOnce({ samePort });
    });
  return restartChain;
}

async function restartExecutorAndReloadOnce({ samePort = false } = {}) {
  switchingAccount = true;
  let started = false;
  try {
    await stopExecutor();
    // startExecutor picks up the new path, waits for the executor to be ready, and refreshes
    // port/token — which the reloaded renderer asks for again over IPC, so it never sees the old
    // credentials.
    await startExecutor({ samePort });
    started = true;
  } catch (err) {
    console.error('[main] Could not start the executor for the selected account:', err);
    // A refused start (78, 79) has already said why in a dialog, from the exit handler.
    // Fall through to the reload anyway: the renderer's boot will surface a connection failure,
    // which is a screen the user can act on. Leaving them on a spinner is not.
  } finally {
    switchingAccount = false;
  }

  // A start that failed because its executor died is followed by the restart that death queued,
  // which reloads in its turn: reloading here as well would show the connection failure for the
  // moment between the two.
  if (!started && restartsQueued > 0) return;

  if (!mainWindow || mainWindow.isDestroyed()) return;

  // Paint the gap in the app's own colour.
  //
  // A reload repaints the window from its background colour, which defaults to white — so on a
  // dark theme the switch flashes white for the frames before the new document paints.
  //
  // Resolved from `--we-color-neutral-0`, the token the boot screen itself uses, via a throwaway
  // element: the token's authored form varies (hex, hsl parts, whatever a custom theme sets) and
  // `getComputedStyle` on a real element hands back a resolved `rgb()` string whatever it was.
  // Reading `document.body`'s own background instead — the first attempt — picked up the browser
  // default rather than the app's, which is why the flash was a lighter shade than the app.
  try {
    const background = await mainWindow.webContents.executeJavaScript(
      `(() => {
         const probe = document.createElement('div');
         probe.style.cssText = 'position:absolute;visibility:hidden;background:var(--we-color-neutral-0)';
         document.body.appendChild(probe);
         const resolved = getComputedStyle(probe).backgroundColor;
         probe.remove();
         return resolved;
       })()`,
    );
    // Reject transparent: an unset token would otherwise set the window transparent-black, which
    // paints as the very white this exists to avoid.
    if (background && !background.startsWith('rgba(0, 0, 0, 0')) mainWindow.setBackgroundColor(background);
  } catch {
    // Best effort — a white frame is a blemish, not a reason to abandon the switch.
  }

  // Load the app root rather than reloading the current URL. Two reasons, and the second is why
  // this is more than tidiness: after a switch the previous URL belongs to the account being left
  // — a deep link into one of *its* spaces, which need not exist in the account now being opened.
  // And in a packaged build a reload re-requests that deep path from the express server, where
  // anything the static middleware cannot match falls through to a catch-all; that is the shape of
  // the NotFoundError seen when creating an account from a built app.
  mainWindow.loadURL(appUrl());
}

/**
 * Ask the window to choose a screen, and wait for the answer.
 *
 * ## Why the ask goes this way round
 *
 * The obvious alternative is for the renderer to choose *before* it calls `getDisplayMedia` and
 * stash the answer for this handler to read. It cannot: with `useSystemPicker` on, Electron does not
 * call the handler at all where the OS has a picker, so the renderer would have to know in advance
 * whether its own picker was wanted — and the only way to know is to guess from the platform and the
 * OS version. Asking from inside the handler needs no guess, because reaching the handler *is* the
 * condition.
 *
 * Thumbnails are sent as data URLs rather than as `NativeImage`s: what crosses is then plainly a
 * string, and the renderer needs no Electron type to read it.
 *
 * ## The timeout is a release, not a policy
 *
 * A renderer that never answers — reloaded mid-share, crashed, a build with no picker in it — must
 * not leave this promise outstanding forever, because the handler is holding a `getDisplayMedia`
 * that the page is awaiting. Falling back to no selection reads as "cancelled" on the other side,
 * which is the honest outcome: nothing was chosen.
 */
const SCREEN_PICK_TIMEOUT_MS = 60_000;

function askRendererForScreenSource(window, sources) {
  if (!window || window.isDestroyed()) return Promise.resolve('');

  return new Promise((resolve) => {
    let settled = false;
    const finish = (id) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ipcMain.removeListener('screen-source-picked', onPicked);
      resolve(id);
    };

    // Keyed by nothing: one share at a time per window, and a second request would have had to wait
    // on the first anyway. A stale answer to a request that has already timed out is dropped by
    // `settled`.
    const onPicked = (event, id) => {
      if (!isFromWindow(event, window, isAppUrl)) return;
      finish(typeof id === 'string' ? id : '');
    };

    const timer = setTimeout(() => finish(''), SCREEN_PICK_TIMEOUT_MS);
    ipcMain.on('screen-source-picked', onPicked);

    window.webContents.send(
      'screen-source-request',
      sources.map((source) => ({
        id: source.id,
        name: source.name,
        // A screen has no window title worth showing; Electron names them "Entire screen" and
        // similar already, so nothing is invented here.
        thumbnail: source.thumbnail?.toDataURL?.() ?? '',
      })),
    );
  });
}

handle('get-desktop-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
  });
  return sources;
});

app.whenReady().then(async () => {
  // Start the app server in production (serves bundled Flux)
  if (!process.env.VITE_DEV_SERVER_URL) {
    startAppServer();
  }

  if (process.env.WE_EXTERNAL_AD4M_PORT && process.env.WE_EXTERNAL_AD4M_TOKEN) {
    ad4mPort = Number(process.env.WE_EXTERNAL_AD4M_PORT);
    ad4mToken = process.env.WE_EXTERNAL_AD4M_TOKEN;
    console.log('[main] External executor mode — port:', ad4mPort);
    startCustodyFor(ad4mPort, ad4mToken);
  } else {
    try {
      await startExecutor();
    } catch (err) {
      // No window exists yet, so this box is the only way to say the app failed. Before it, the
      // rejection went unhandled and the app ran on with no window until it was killed.
      const logLine = executorLog ? `\n\nThe executor's log: ${executorLog.path}` : '';
      dialog.showErrorBox(
        'The app could not start',
        `The AD4M executor it runs on did not start.\n\n${err.message}${logLine}`,
      );
      app.quit();
      return;
    }
  }

  // Then create the window
  installApplicationMenu();
  installTray();
  createWindow();

  // macOS: a click on the Dock icon opens the window, hidden or not.
  app.on('activate', () => openMainWindow());
});

/**
 * The menu bar — Electron's own menus, plus a way into safe mode.
 *
 * The menu bar is drawn by the operating system, so nothing a template renders can cover it or
 * take it away. That makes it the desktop's door into safe mode for an interface that loads fine
 * and offers no way out: it loads the same `?safe` address the web uses, which the app reads before
 * any template renders. See `safeMode.ts` in `@we/app-shell`.
 *
 * Built from roles rather than taken from Electron's default menu, which cannot have an item added
 * to it. Every menu here is the default one under its role; Help is the only one that differs.
 */
function installApplicationMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Restart in Safe Mode',
          click: () => {
            const url = new URL(appUrl());
            url.searchParams.set('safe', '');
            mainWindow?.loadURL(url.toString());
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Stop the executor and the custody sidecar beside it.
const stopExecutor = () => Promise.all([stopCustody(), stopExecutorProcess()]);

// Stop the executor and wait for it to exit: closing its stdin (`--watch-stdin true`) lets it shut
// the Holochain conductor down and exit 0; SIGTERM, then SIGKILL to its process group (spawned
// detached), only if it does not exit in time. A second call while a stop is in progress waits for
// that same stop.
let executorStopping = Promise.resolve();
function stopExecutorProcess() {
  const proc = executorProcess;
  executorProcess = null;
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return executorStopping;
  executorStopping = (async () => {
    const how = await stopChild(proc, {
      fallback: process.platform === 'win32' ? async () => (proc.kill(), 'killed') : undefined,
    });
    console.log(`[main] Executor stopped (${how})`);
  })();
  return executorStopping;
}

/** Set once the app has begun to quit: a window closing then closes rather than hiding. */
let appQuitting = false;

// Stop the executor before Electron quits (covers Cmd+Q, the tray's Quit, app.quit(), etc.).
// Quitting waits for it: the first before-quit is held, the executor stopped, then the quit resumes.
let executorStoppedForQuit = false;
app.on('before-quit', (event) => {
  appQuitting = true;
  if (process.env.WE_EXTERNAL_AD4M_PORT || executorStoppedForQuit) return;
  event.preventDefault();
  executorStoppedForQuit = true;
  stopExecutor().finally(() => app.quit());
});

// Reached only when a window closed rather than hiding (no tray icon to reopen it from), or on quit.
app.on('window-all-closed', () => app.quit());

// ── The tray icon, and closing the window (see `tray.js`) ────────────────────
let tray = null;

/** Show the main window again, and the app in the Dock on macOS. */
function openMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (process.platform === 'darwin') void app.dock?.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/**
 * Closing the main window hides it while the tray icon can bring it back: the app and its executor
 * keep running. On macOS the app also leaves the Dock until the window is opened again, unless the
 * identity window is showing.
 */
function hideOnClose(window) {
  window.on('close', (event) => {
    if (!closeHides({ quitting: appQuitting, trayUp: tray !== null, hostPresent: trayHostPresent() })) {
      if (!appQuitting) console.log('[tray] No tray host to reopen the window from; closing it quits the app');
      return;
    }
    event.preventDefault();
    window.hide();
    if (process.platform === 'darwin' && !identity.window()?.isVisible?.()) app.dock?.hide();
  });
}

function installTray() {
  if (process.platform === 'linux' && !trayHostPresent()) {
    console.warn(
      '[tray] No tray host (org.kde.StatusNotifierWatcher) on the session bus now: no icon shows, and closing the window quits the app',
    );
  }
  tray = createTray({
    Tray,
    Menu,
    // The window icon, at menu-bar size where the OS draws it as given (macOS, Windows).
    icon:
      process.platform === 'linux'
        ? windowIcon()
        : nativeImage.createFromPath(windowIcon()).resize({ width: 16, height: 16 }),
    name: app.getName(),
    onOpen: openMainWindow,
    onQuit: () => app.quit(),
  });
}
