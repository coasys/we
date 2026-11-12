/**
 * The supervisor in `main.js`, driven end to end as in `main.supervisor.test.js`, for an exit 0 the
 * app did not ask for.
 *
 * Scenario: the running executor exits 0 on its own (`runtime.quit`, or a SIGTERM from outside the
 * app). The app stops only its own executor, and clears it as the current one first, so this exit
 * was asked for elsewhere. Nothing starts it again, so the app says the executor stopped rather than
 * leaving the window up with no executor behind it.
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
      this.webContents = {
        mainFrame: { processId: 1, routingId: 1 },
        setWindowOpenHandler: () => {},
        on: () => {},
        send: () => {},
        executeJavaScript: async () => 'rgb(0, 0, 0)',
        session: {
          setDisplayMediaRequestHandler: () => {},
          setPermissionRequestHandler: () => {},
          setPermissionCheckHandler: () => {},
          webRequest: { onHeadersReceived: () => {} },
        },
      };
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

describe.skipIf(process.platform === 'win32' || !existsSync(join(here, 'seed-csp.json')))(
  'the supervisor, on an exit 0 the app did not ask for',
  () => {
    beforeAll(async () => {
      state.root = mkdtempSync(join(tmpdir(), 'we-supervisor-'));
      const resources = join(state.root, 'resources');
      mkdirSync(resources);
      mkdirSync(dataDir());
      const fake = `#!${process.execPath}\n${readFileSync(join(here, 'fixtures', 'fake-executor.cjs'), 'utf8')}`;
      writeFileSync(join(resources, 'ad4m-executor'), fake);
      chmodSync(join(resources, 'ad4m-executor'), 0o755);
      // Start 1 serves, then stops as `runtime.quit` would (0).
      writeFileSync(
        join(dataDir(), 'fake-executor.plan.json'),
        JSON.stringify({ steps: [{ serve: true, thenExit: 0, afterMs: 1_500 }] }),
      );

      process.resourcesPath = resources;
      process.env.WE_AD4M_DATA_PATH = dataDir();
      process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173';
      delete process.env.WE_EXTERNAL_AD4M_PORT;
      delete process.env.WE_EXTERNAL_AD4M_TOKEN;

      await import('./main.js');
      state.readyResolve();
      await until(() => state.windows.length === 1 && state.windows[0].loads.length === 1);
    }, 60_000);

    afterAll(async () => {
      for (const pid of pids()) if (alive(pid)) process.kill(pid, 'SIGKILL');
      await sleep(200);
      rmSync(state.root, { recursive: true, force: true });
    });

    it('says the executor stopped, and starts nothing more', async () => {
      await until(() => /^1 exit 0$/m.test(executorLog()), 30_000);
      await until(() => state.messageBoxes.length > 0, 5_000);
      // Time enough for anything else the exit set in motion.
      await sleep(2_500);

      expect(starts()).toHaveLength(1);
      expect(state.messageBoxes).toHaveLength(1);
      const [, box] = state.messageBoxes[0];
      expect(box.message).toBe('The AD4M executor stopped');
      expect(box.detail).toMatch(/stopped outside the app/);
      expect(box.detail).toMatch(/executor-0\.log/);
      // The window stays on what it shows: nothing was started to reload it onto.
      expect(state.windows[0].loads).toHaveLength(1);
    }, 60_000);
  },
);
