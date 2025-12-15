import { spawn } from 'child_process';
import { app, BrowserWindow, ipcMain } from 'electron';
import express from 'express';
import { existsSync } from 'fs';
import net from 'net';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

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

// Start the AD4M executor
async function startExecutor() {
  try {
    // Find a free port for GraphQL
    ad4mPort = await findFreePort(12000, 13000);

    // Generate credential token
    ad4mToken = uuidv4();

    // Get AD4M data directory
    const ad4mDataPath = join(homedir(), '.ad4m');

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
        '--gql-port',
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
        stdio: 'inherit',
      },
    );

    executorProcess.on('error', (err) => {
      console.error('Failed to start executor:', err);
    });

    executorProcess.on('exit', (code) => {
      console.log('Executor exited with code:', code);
    });

    console.log('AD4M executor started');
  } catch (error) {
    console.error('Error starting executor:', error);
    throw error;
  }
}

// Start HTTP server to serve bundled app (production only)
function startAppServer() {
  const appServer = express();

  // Path to bundled app (Flux)
  const appDir = app.isPackaged
    ? join(process.resourcesPath, 'flux')
    : join(__dirname, '..', '..', '..', '..', 'flux', 'app', 'dist');

  if (existsSync(appDir)) {
    console.log('Starting app HTTP server on http://localhost:8080');
    console.log('Serving from:', appDir);

    // Serve static files without X-Frame-Options restrictions
    appServer.use(
      express.static(appDir, {
        setHeaders: (res) => {
          res.removeHeader('X-Frame-Options');
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        },
      }),
    );

    // Fallback to index.html for SPA routing (use middleware instead of route)
    appServer.use((req, res) => {
      res.sendFile(join(appDir, 'index.html'));
    });

    appServer.listen(8080, () => {
      console.log('App server listening on port 8080');
    });
  } else {
    console.warn('App directory not found at:', appDir);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In development, load from Vite dev server
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load the built files
    mainWindow.loadFile(join(__dirname, '../dist/index.html'));
  }
}

// IPC handlers for AD4M connection details
ipcMain.handle('get-port', () => {
  return ad4mPort;
});

ipcMain.handle('get-token', () => {
  return ad4mToken;
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

app.on('window-all-closed', () => {
  // Kill the executor process
  if (executorProcess) {
    executorProcess.kill();
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
