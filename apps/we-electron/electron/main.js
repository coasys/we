import { execSync, spawn } from 'child_process';
import { app, BrowserWindow, desktopCapturer, ipcMain } from 'electron';
import contextMenu from 'electron-context-menu';
import express from 'express';
import { existsSync, readdirSync, rmSync } from 'fs';
import http from 'http';
import net from 'net';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

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
    const ad4mDataPath = join(homedir(), '.ad4m');

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
      const msg = `[main] Executor exited — code: ${code}, signal: ${signal}`;
      console.log(msg);
      // Notify the renderer so it shows in DevTools even in packaged builds
      mainWindow?.webContents.executeJavaScript(`console.error(${JSON.stringify(msg)})`).catch(() => {});
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

  // In development, load from Vite dev server
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    // mainWindow.webContents.openDevTools();
  } else {
    // In production, load from HTTP server (same protocol as iframe)
    mainWindow.loadURL('http://localhost:9080');
  }
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
