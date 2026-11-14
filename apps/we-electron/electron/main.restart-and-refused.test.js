/**
 * The supervisor in `main.js`, driven end to end as in `main.supervisor.test.js`, for exit 75 and for
 * a 78 after the window exists.
 *
 * Scenario: the running executor exits 75 (`runtime.restart`) twice; each time the app starts it
 * again at once on the same port and reloads the window. The third start exits 78 (a refused
 * config): the app shows what happened, starts nothing more, and still reloads the window so it
 * shows the connection failure rather than a spinner.
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
const ports = () => starts().map((line) => Number(line.match(/port=(\d+)/)[1]));
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
  'the supervisor, on exit 75 and on a 78 after the window exists',
  () => {
    beforeAll(async () => {
      state.root = mkdtempSync(join(tmpdir(), 'we-supervisor-'));
      const resources = join(state.root, 'resources');
      mkdirSync(resources);
      mkdirSync(dataDir());
      const fake = `#!${process.execPath}\n${readFileSync(join(here, 'fixtures', 'fake-executor.cjs'), 'utf8')}`;
      writeFileSync(join(resources, 'ad4m-executor'), fake);
      chmodSync(join(resources, 'ad4m-executor'), 0o755);
      // Starts 1 and 2 serve, then ask to be restarted (75); start 3 refuses its config (78).
      const restart = { serve: true, thenExit: 75, afterMs: 1_500 };
      writeFileSync(join(dataDir(), 'fake-executor.plan.json'), JSON.stringify({ steps: [restart, restart, 78] }));

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

    it('starts it again on the same port after a 75, then stops at a 78 and says so', async () => {
      await until(() => /^3 exit 78$/m.test(executorLog()), 30_000);
      // Time enough for anything else the 78 set in motion.
      await sleep(2_500);

      expect(starts()).toHaveLength(3);
      // 75: the same arguments, so the same port, twice over.
      expect(ports()[1]).toBe(ports()[0]);
      expect(ports()[2]).toBe(ports()[0]);
      // 78: not started again; one box with the executor's last lines and the config file.
      expect(state.messageBoxes).toHaveLength(1);
      const [, box] = state.messageBoxes[0];
      expect(box.message).toBe('WE stopped');
      expect(box.detail).toMatch(/executor-config\.json/);
      expect(box.detail).toMatch(/exits 78/);
      // The window reloaded once per restart: after the first 75 onto the new executor, and after
      // the second onto the failure, which the renderer shows rather than a spinner.
      expect(state.windows[0].loads).toHaveLength(3);
      expect(pids().every((pid) => !alive(pid))).toBe(true);
    }, 60_000);
  },
);
