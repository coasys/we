/**
 * The supervisor in `main.js`, driven end to end: Electron's modules are stand-ins, the executor is
 * `fixtures/fake-executor.cjs` following a plan, and the test reads what the app started, stopped
 * and reloaded. One file per scenario: `main.js` keeps its state in module scope.
 *
 * Scenario: the app is up, a restart is asked for (the `executor-restart` IPC), and the executor
 * that restart starts exits 80 before it is ready. The app must recover it once: start another on a
 * new port, and leave that one running.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const s = {
    handlers: {},
    ipc: {},
    windows: [],
    quits: 0,
    quitDone: false,
    messageBoxes: [],
    errorBoxes: [],
    // What the main process told the window of its executor (`executor-state`), in order.
    executorStates: [],
    readyResolve: null,
    ready: null,
  };
  s.ready = new Promise((resolve) => (s.readyResolve = resolve));
  return s;
});

vi.mock('electron-context-menu', () => ({ default: () => {} }));

vi.mock('electron', () => {
  const on = (event, fn) => (state.handlers[event] ??= []).push(fn);
  const app = {
    isPackaged: true,
    requestSingleInstanceLock: () => true,
    on,
    getPath: (name) => join(state.root, name),
    getName: () => 'WE',
    setName: () => {},
    whenReady: () => state.ready,
    quit() {
      state.quits += 1;
      const event = { prevented: false, preventDefault: () => (event.prevented = true) };
      for (const fn of state.handlers['before-quit'] ?? []) fn(event);
      if (!event.prevented) state.quitDone = true;
    },
  };
  class BrowserWindow {
    constructor(options) {
      this.options = options;
      this.loads = [];
      this.destroyed = false;
      const contents = {
        mainFrame: { processId: 1, routingId: 1 },
        setWindowOpenHandler: () => {},
        on: () => {},
        send: (channel, payload) => channel === 'executor-state' && state.executorStates.push(payload),
        executeJavaScript: async () => 'rgb(0, 0, 0)',
        session: {
          setDisplayMediaRequestHandler: () => {},
          setPermissionRequestHandler: () => {},
          setPermissionCheckHandler: () => {},
          webRequest: { onHeadersReceived: () => {} },
        },
      };
      this.webContents = contents;
      state.windows.push(this);
    }
    on() {}
    once() {}
    maximize() {}
    show() {}
    hide() {}
    focus() {}
    restore() {}
    isMinimized() {
      return false;
    }
    isDestroyed() {
      return this.destroyed;
    }
    removeMenu() {}
    setBackgroundColor() {}
    loadURL(url) {
      this.loads.push(url);
    }
  }
  class Tray {
    setToolTip() {}
    setContextMenu() {}
    on() {}
  }
  return {
    app,
    BrowserWindow,
    Tray,
    desktopCapturer: { getSources: async () => [] },
    dialog: {
      showMessageBox: async (...args) => (state.messageBoxes.push(args), { response: 0 }),
      showErrorBox: (...args) => state.errorBoxes.push(args),
      showSaveDialog: async () => ({ canceled: true }),
      showOpenDialog: async () => ({ canceled: true }),
    },
    ipcMain: {
      handle: (channel, fn) => (state.ipc[channel] = fn),
      on: () => {},
      removeListener: () => {},
    },
    Menu: { buildFromTemplate: (template) => template, setApplicationMenu: () => {} },
    nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
    net: { fetch: async () => ({}) },
    protocol: { registerSchemesAsPrivileged: () => {} },
    session: {
      fromPartition: () => ({
        protocol: { handle: () => {} },
        setPermissionRequestHandler: () => {},
        setPermissionCheckHandler: () => {},
      }),
    },
    shell: { openExternal: () => {} },
  };
});

const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll until `check` holds, or fail after `ms`. */
async function until(check, ms = 20_000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (check()) return;
  throw new Error('timed out waiting');
}

const dataDir = () => join(state.root, 'data');
const executorLog = () =>
  existsSync(join(dataDir(), 'fake-executor.log')) ? readFileSync(join(dataDir(), 'fake-executor.log'), 'utf8') : '';
const starts = () =>
  executorLog()
    .split('\n')
    .filter((line) => / start /.test(line));
const pids = () => starts().map((line) => Number(line.match(/pid=(\d+)/)[1]));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Call an invoke handler as the main window's top frame would. */
const invoke = (channel, ...args) => {
  const window = state.windows[0];
  const event = {
    sender: window.webContents,
    senderFrame: { processId: 1, routingId: 1, url: `${process.env.VITE_DEV_SERVER_URL}/` },
  };
  return state.ipc[channel](event, ...args);
};

describe.skipIf(process.platform === 'win32' || !existsSync(join(here, 'seed-csp.json')))(
  'the supervisor, on an exit 80 during a restart',
  () => {
    beforeAll(async () => {
      state.root = mkdtempSync(join(tmpdir(), 'we-supervisor-'));
      const resources = join(state.root, 'resources');
      mkdirSync(resources);
      mkdirSync(dataDir());
      // The fake executor, where a packaged app finds its binary, run by this Node.
      const fake = `#!${process.execPath}\n${readFileSync(join(here, 'fixtures', 'fake-executor.cjs'), 'utf8')}`;
      writeFileSync(join(resources, 'ad4m-executor'), fake);
      chmodSync(join(resources, 'ad4m-executor'), 0o755);
      // Start 1 serves; start 2 (the restart) exits 80; every later start serves.
      writeFileSync(join(dataDir(), 'fake-executor.plan.json'), JSON.stringify({ steps: ['serve', 80] }));

      process.resourcesPath = resources;
      process.env.WE_AD4M_DATA_PATH = dataDir();
      process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173';
      delete process.env.WE_EXTERNAL_AD4M_PORT;
      delete process.env.WE_EXTERNAL_AD4M_TOKEN;

      await import('./main.js');
      state.readyResolve();
      // The window opens before the executor starts; it is up once the window hears it is ready.
      await until(() => state.windows.length === 1 && state.windows[0].loads.length === 1);
      await until(() => state.executorStates.at(-1)?.phase === 'ready');
    }, 60_000);

    afterAll(async () => {
      for (const pid of pids()) if (alive(pid)) process.kill(pid, 'SIGKILL');
      await sleep(200);
      rmSync(state.root, { recursive: true, force: true });
    });

    it('starts one more executor, and leaves it running', async () => {
      expect(starts()).toHaveLength(1);
      // The settings page's host restart. The restart's executor exits 80; the app starts another.
      await invoke('executor-restart');
      await until(() => /^3 ready$/m.test(executorLog()));
      // Time enough for anything else the exit 80 set in motion.
      await sleep(3_000);

      const log = executorLog();
      expect(log).toMatch(/^2 exit 80$/m);
      // The third start is the recovery, and it stays: nothing stops it to start a fourth.
      expect(log).not.toMatch(/^3 stdin closed$/m);
      expect(starts()).toHaveLength(3);
      expect(alive(pids()[2])).toBe(true);
      // The window reloaded once for the restart.
      expect(state.windows[0].loads).toHaveLength(2);
    }, 60_000);

    it('stops the running executor on quit, and nothing is left', async () => {
      const { app } = await import('electron');
      app.quit();
      await until(() => state.quitDone);
      expect(executorLog()).toMatch(/^3 stdin closed$/m);
      await until(() => pids().every((pid) => !alive(pid)), 5_000);
    }, 30_000);
  },
);
