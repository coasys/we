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
    // What the main window was sent, as [channel, payload], and each menu the tray was given.
    sent: [],
    trayMenus: [],
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
        send: (channel, payload) => state.sent.push([channel, payload]),
        isLoading: () => false,
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
    setContextMenu(menu) {
      state.trayMenus.push(menu);
    }
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
/** The executor state last sent to the window. */
const lastState = () => state.sent.filter(([channel]) => channel === 'executor-state').at(-1)?.[1];
/** The tray's menu as last drawn, and an item of it by label. */
const tray = () => state.trayMenus.at(-1) ?? [];
const trayItem = (label) =>
  tray().find((item) => (typeof label === 'string' ? item.label === label : label.test(item.label ?? '')));
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
      writeFileSync(join(resources, 'ws-lite.cjs'), readFileSync(join(here, 'fixtures', 'ws-lite.cjs')));
      // Start 1 serves, then stops as `runtime.quit` would (0). Its storage is open (its secret given
      // it otherwise): no keyring helper is needed.
      writeFileSync(
        join(dataDir(), 'fake-executor.plan.json'),
        JSON.stringify({ steps: [{ serve: true, thenExit: 0, afterMs: 1_500 }], storage: 'open' }),
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
      expect(box.message).toMatch(/ has stopped$/);
      expect(box.detail).toMatch(/stopped outside the app/);
      expect(box.detail).toMatch(/executor-0\.log/);
      // The window stays on what it shows: nothing was started to reload it onto.
      expect(state.windows[0].loads).toHaveLength(1);
      // Told it stopped after running, so the base takes the window back and offers to start it.
      expect(lastState()).toMatchObject({ phase: 'failed', stopped: true });
      expect(lastState().reason).toMatch(/stopped outside the app/);
      // The tray says so, and offers Start, under the app's name.
      expect(trayItem(/^WE: /)).toEqual({ label: 'WE: stopped', enabled: false });
      expect(trayItem('Start WE').enabled).not.toBe(false);
      expect(trayItem('Stop WE').enabled).toBe(false);
      for (const item of tray()) expect(item.label ?? '').not.toMatch(/electron/i);
    }, 60_000);

    it("starts it again from the tray, through the window's own start", async () => {
      trayItem('Start WE').click();
      await until(() => starts().length === 2 && /^2 ready$/m.test(executorLog()), 30_000);
      await until(() => lastState()?.phase === 'ready', 10_000);
      expect(trayItem(/^WE: /).label).toBe('WE: running');
      expect(trayItem('Restart WE')).toBeTruthy();
      expect(trayItem('Stop WE').enabled).not.toBe(false);
    }, 60_000);

    it('stops it from the tray, says so, and starts nothing again', async () => {
      trayItem('Stop WE').click();
      await until(() => lastState()?.phase === 'failed', 10_000);
      expect(lastState()).toEqual({
        phase: 'failed',
        reason: 'The executor was stopped from the tray menu. It stays stopped until it is started again.',
        stopped: true,
      });
      await until(() => /^2 (exit|stdin closed)/m.test(executorLog()), 10_000);
      await sleep(2_000);
      expect(starts()).toHaveLength(2);
      // A stop asked for is not a fault: no dialog beyond the first one.
      expect(state.messageBoxes).toHaveLength(1);
      expect(trayItem(/^WE: /).label).toBe('WE: stopped');
    }, 60_000);

    it("opens the executor's settings in the main window from the tray", () => {
      trayItem('Executor settings…').click();
      expect(state.sent.at(-1)).toEqual(['open-executor-settings', undefined]);
    });
  },
);
