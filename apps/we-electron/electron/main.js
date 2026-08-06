import { execSync, spawn } from 'child_process';
import { app, BrowserWindow, desktopCapturer, ipcMain } from 'electron';
import contextMenu from 'electron-context-menu';
import express from 'express';
import { existsSync, readdirSync, readFileSync, rmSync } from 'fs';
import http from 'http';
import net from 'net';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

import { createAccountRegistry, expandHome } from './accounts.js';
import { setupSeedServers } from './seed-servers.js';

// Enable right-click context menu with inspect element in dev mode
contextMenu({
  showInspectElement: true,
  showSearchWithGoogle: false,
  showSaveImageAs: true,
  showCopyImage: true,
  showCopyImageAddress: true,
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow;
let ad4mPort = null;
let ad4mToken = null;
let executorProcess = null;
/** Set while an account switch is tearing the executor down on purpose. */
let switchingAccount = false;

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
 */
function ensureDataPathInitialised(executorPath, dataPath) {
  if (existsSync(join(dataPath, 'mainnet_seed.seed'))) return;

  console.log('[main] Data path not initialised, running executor init:', dataPath);
  try {
    execSync(`"${executorPath}" init --data-path "${dataPath}"`, { stdio: 'inherit' });
    console.log('[main] Executor init complete');
  } catch (e) {
    // Surfaced rather than thrown: the executor may still start, and a hard failure here would
    // turn a recoverable state into an app that will not open at all.
    console.error('[main] Executor init failed — the executor may not start correctly:', e.message);
  }
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

// Wait for the GraphQL server to be fully ready (not just TCP port open).
// Polls the /graphql HTTP endpoint — any HTTP response (even 400) means GraphQL is up.
async function waitForGraphQL(port, maxAttempts = 120, interval = 500) {
  for (let i = 0; i < maxAttempts; i++) {
    const ready = await new Promise((resolve) => {
      const req = http.request(
        {
          method: 'POST',
          hostname: '127.0.0.1',
          port,
          path: '/graphql',
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          res.resume(); // discard response body
          resolve(true);
        },
      );
      req.on('error', () => resolve(false));
      req.write(JSON.stringify({ query: '{ __typename }' }));
      req.end();
    });

    if (ready) {
      console.log(`GraphQL server on port ${port} is ready`);
      return;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`GraphQL server on port ${port} not ready after ${maxAttempts} attempts`);
}

// Start the AD4M executor
async function startExecutor() {
  try {
    // Find a free port for GraphQL
    ad4mPort = await findFreePort(12000, 13000);

    // Generate credential token
    ad4mToken = uuidv4();

    // Get AD4M data directory
    const ad4mDataPath = resolveAd4mDataPath();

    // Kill any surviving ad4m-executor from a previous detached run (survives Ctrl+C).
    // Must happen BEFORE the lair socket / LOCK cleanups so the old process releases
    // its file handles before we delete them — otherwise it just re-acquires them.
    if (process.platform !== 'win32') {
      try {
        execSync('pkill -SIGKILL -f ad4m-executor', { stdio: 'ignore' });
        // Give the OS a moment to release RocksDB / lair file handles
        await new Promise((r) => setTimeout(r, 800));
      } catch {
        // pkill exits with code 1 when no matching process is found — not an error
      }
    }

    // Clean up stale lair-keystore socket file — if a previous run crashed without
    // killing child processes, this socket stays on disk and causes lair-keystore
    // to fail on the next agent.unlock(), which crashes the executor.
    const keychainSocketPath = join(ad4mDataPath, 'ad4m', 'h', 'c', 'ks', 'socket');
    if (existsSync(keychainSocketPath)) {
      console.log('[main] Removing stale lair-keystore socket:', keychainSocketPath);
      try {
        rmSync(keychainSocketPath);
      } catch (e) {
        console.warn('[main] Could not remove socket:', e.message);
      }
    }

    // Clean up stale RocksDB LOCK files left by a detached executor that survived
    // a Ctrl+C / forced quit. Without this, the next launch panics with
    // "Resource temporarily unavailable" on every perspective's SPARQL store.
    const perspectivesDir = join(ad4mDataPath, 'perspectives');
    if (existsSync(perspectivesDir)) {
      try {
        for (const uuid of readdirSync(perspectivesDir)) {
          const lockFile = join(perspectivesDir, uuid, 'sparql_store', 'LOCK');
          if (existsSync(lockFile)) {
            console.log('[main] Removing stale SPARQL LOCK:', lockFile);
            rmSync(lockFile);
          }
        }
      } catch (e) {
        console.warn('[main] Could not clean SPARQL LOCK files:', e.message);
      }
    }

    console.log('Starting AD4M executor...');
    console.log('Port:', ad4mPort);
    console.log('Data path:', ad4mDataPath);

    // Path to the executor binary
    // In production, this will be bundled with the app
    // In development, we need to point to the built executor from ad4m repo
    const executorPath = app.isPackaged
      ? join(process.resourcesPath, 'ad4m-executor')
      : join(__dirname, '..', '..', '..', '..', 'ad4m', 'target', 'release', 'ad4m-executor');

    console.log('Executor path:', executorPath);

    ensureDataPathInitialised(executorPath, ad4mDataPath);

    // Start the executor process
    executorProcess = spawn(
      executorPath,
      [
        'run', // The 'run' subcommand
        '--port',
        ad4mPort.toString(),
        '--admin-credential',
        ad4mToken,
        '--app-data-path',
        ad4mDataPath,
        '--run-dapp-server',
        'false', // We don't need the built-in dapp server
        '--connect-holochain',
        'true', // Enable holochain connection
      ],
      {
        detached: true, // Create a new process group so we can kill the entire tree
        stdio: ['ignore', 'pipe', 'pipe'], // Capture stdout/stderr instead of inherit
      },
    );

    // Detach from the parent — lets Node.js exit without waiting for the child,
    // and is required for process.kill(-pid) group-kill to work.
    executorProcess.unref();
    // Also unref the stdio streams — without this, the piped stdout/stderr keep
    // Electron's event loop alive after the executor is killed, causing a second
    // Ctrl+C to be needed to return to the terminal prompt.
    executorProcess.stdout?.unref();
    executorProcess.stderr?.unref();

    // Forward executor output to console (prevents EPIPE errors)
    executorProcess.stdout?.on('data', (data) => {
      process.stdout.write(data);
    });

    executorProcess.stderr?.on('data', (data) => {
      process.stderr.write(data);
    });

    executorProcess.on('error', (err) => {
      console.error('Failed to start executor:', err);
    });

    executorProcess.on('exit', (code, signal) => {
      // Expected during an account switch — we killed it on purpose and are about to respawn.
      if (switchingAccount) return;

      const msg = `[main] Executor exited — code: ${code}, signal: ${signal}`;
      console.log(msg);
      // Notify the renderer so it shows in DevTools even in packaged builds.
      //
      // `mainWindow?.` only guards against null, not against a *destroyed* window: on quit the
      // reference survives its BrowserWindow, and killing the executor makes this handler fire
      // right afterwards — reaching webContents then throws "Object has been destroyed" as an
      // uncaught exception, on the way out, where it looks like a crash.
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.executeJavaScript(`console.error(${JSON.stringify(msg)})`).catch(() => {});
    });

    console.log('AD4M executor process started, waiting for GraphQL server...');

    // Wait for the GraphQL server to be fully ready (not just TCP port open)
    await waitForGraphQL(ad4mPort);

    console.log('AD4M executor ready');
  } catch (error) {
    console.error('Error starting executor:', error);
    throw error;
  }
}

// Start HTTP servers to serve bundled apps (production only)
function startAppServer() {
  console.log('🚀 Starting application servers...\n');

  // Setup seed-based app servers (Flux, Playground, etc.)
  setupSeedServers();

  // Setup launcher (WE app itself) on port 9080
  const launcherDir = app.isPackaged ? join(process.resourcesPath, 'app', 'dist') : join(__dirname, '..', 'dist');

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

    launcherApp.use((req, res) => {
      res.sendFile(join(launcherDir, 'index.html'));
    });

    launcherApp.listen(9080, () => {
      console.log('   ✓ WE launcher listening on port 9080\n');
    });
  } else {
    console.warn('⚠️  WE launcher directory not found at:', launcherDir);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    show: false, // Don't show until ready
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // Allow cross-origin access for screen sharing in iframes
    },
  });

  // Show window only when content is ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  // Allow camera, microphone, and screen capture permissions
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'camera', 'microphone', 'display-capture', 'mediaKeySystem'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      callback(false);
    }
  });

  // Also handle permission checks (not just requests)
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission) => {
    const allowedPermissions = ['media', 'camera', 'microphone', 'display-capture'];
    return allowedPermissions.includes(permission);
  });

  mainWindow.loadURL(appUrl());
}

/**
 * Where the app is served from. Vite in development; the bundled express server in production,
 * over HTTP rather than file:// so it shares a protocol with the app iframes.
 */
function appUrl() {
  return process.env.VITE_DEV_SERVER_URL || 'http://localhost:9080';
}

// IPC handlers for AD4M connection details
ipcMain.handle('get-port', () => {
  return ad4mPort;
});

ipcMain.handle('get-token', () => {
  return ad4mToken;
});

ipcMain.handle('get-is-development', () => {
  return !!process.env.VITE_DEV_SERVER_URL;
});

// ── Account management ───────────────────────────────────────────────────────
// Every mutation is registry-only; nothing takes effect until the app relaunches, because the
// executor is configured with one data path at startup and holds it for its lifetime.

ipcMain.handle('accounts-list', () => accounts.list());
ipcMain.handle('accounts-create', () => accounts.create());
ipcMain.handle('accounts-display', (_event, id, display) => accounts.setDisplay(id, display));
ipcMain.handle('accounts-select', (_event, id) => accounts.select(id));
ipcMain.handle('accounts-remove', (_event, id) => accounts.remove(id));

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
ipcMain.handle('accounts-apply', async () => {
  switchingAccount = true;
  try {
    killExecutor();
    // startExecutor picks up the new path, waits for GraphQL, and refreshes port/token — which the
    // reloaded renderer asks for again over IPC, so it never sees the old credentials.
    await startExecutor();
  } catch (err) {
    console.error('[main] Could not start the executor for the selected account:', err);
    // Fall through to the reload anyway: the renderer's boot will surface a connection failure,
    // which is a screen the user can act on. Leaving them on a spinner is not.
  } finally {
    switchingAccount = false;
  }

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
});

ipcMain.handle('get-desktop-sources', async () => {
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

  // Start the executor
  await startExecutor();

  // Then create the window
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Kill the executor AND its entire process group (holochain, lair-keystore, etc.)
function killExecutor() {
  if (!executorProcess) return;
  try {
    if (process.platform !== 'win32') {
      // Negative PID kills the entire process group spawned with detached: true
      process.kill(-executorProcess.pid, 'SIGKILL');
    } else {
      executorProcess.kill();
    }
  } catch (err) {
    // Process may already be dead
    console.warn('killExecutor: could not kill process group:', err.message);
  }
  executorProcess = null;
}

// Kill before Electron quits (covers Cmd+Q, app.quit(), etc.)
app.on('before-quit', () => killExecutor());

app.on('window-all-closed', () => {
  killExecutor();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
