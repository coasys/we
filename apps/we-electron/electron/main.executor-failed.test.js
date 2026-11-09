/**
 * The supervisor in `main.js`, driven end to end as in `main.supervisor.test.js`, for a first start
 * that fails.
 *
 * Scenario: the first executor refuses its settings (exit 78). The window is already open, drawing the
 * app before a session: it is told the executor failed and why, with no error box and no quit, and
 * nothing is started again on its own. "Try again" (`executor-start`) starts it, and the second start
 * serves. A second ask while it starts, or once it is up, starts nothing.
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
      this.webContents = {
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

/** An IPC call as the main window's own top frame makes it (`handleFromWindow` checks the sender). */
const fromWindow = () => ({
  sender: state.windows[0].webContents,
  senderFrame: { ...state.windows[0].webContents.mainFrame, url: 'http://localhost:5173/', parent: null },
});
const ask = (channel) => state.ipc[channel](fromWindow());

describe.skipIf(process.platform === 'win32' || !existsSync(join(here, 'seed-csp.json')))(
  'the supervisor, when the first start fails',
  () => {
    beforeAll(async () => {
      state.root = mkdtempSync(join(tmpdir(), 'we-supervisor-'));
      const resources = join(state.root, 'resources');
      mkdirSync(resources);
      mkdirSync(dataDir());
      const fake = `#!${process.execPath}\n${readFileSync(join(here, 'fixtures', 'fake-executor.cjs'), 'utf8')}`;
      writeFileSync(join(resources, 'ad4m-executor'), fake);
      chmodSync(join(resources, 'ad4m-executor'), 0o755);
      // The first start refuses its settings; every later start serves.
      writeFileSync(join(dataDir(), 'fake-executor.plan.json'), JSON.stringify({ steps: [78] }));

      process.resourcesPath = resources;
      process.env.WE_AD4M_DATA_PATH = dataDir();
      process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173';
      delete process.env.WE_EXTERNAL_AD4M_PORT;
      delete process.env.WE_EXTERNAL_AD4M_TOKEN;

      await import('./main.js');
      state.readyResolve();
      await until(() => state.executorStates.at(-1)?.phase === 'failed');
    }, 60_000);

    afterAll(async () => {
      for (const pid of pids()) if (alive(pid)) process.kill(pid, 'SIGKILL');
      await sleep(200);
      rmSync(state.root, { recursive: true, force: true });
    });

    it('keeps the window open and tells it why, with no error box and no quit', async () => {
      // Time enough for anything else the 78 might set in motion.
      await sleep(1_500);
      expect(state.windows).toHaveLength(1);
      expect(state.windows[0].loads).toHaveLength(1);
      expect(state.errorBoxes).toEqual([]);
      expect(state.messageBoxes).toEqual([]);
      expect(state.quits).toBe(0);
      expect(starts()).toHaveLength(1);
      expect(state.executorStates.map((s) => s.phase)).toEqual(['starting', 'failed']);
      const failed = await ask('executor-state');
      expect(failed.phase).toBe('failed');
      expect(failed.reason).toMatch(/refused its settings/);
      expect(failed.reason).toMatch(/executor-config\.json/);
      // No path: the window may be seen by somebody else.
      expect(failed.reason).not.toContain(state.root);
    });

    it('starts it again on "Try again", once however often it is asked', async () => {
      expect(await ask('executor-start')).toEqual({ phase: 'starting' });
      // Asked again while it starts: nothing more is started.
      expect((await ask('executor-start')).phase).toBe('starting');
      await until(() => state.executorStates.at(-1)?.phase === 'ready');
      expect(await ask('executor-state')).toEqual({ phase: 'ready' });
      // Up: a further ask starts nothing either.
      expect(await ask('executor-start')).toEqual({ phase: 'ready' });
      await sleep(500);
      expect(starts()).toHaveLength(2);
      expect(executorLog()).toMatch(/^2 ready$/m);
      // The window was not reloaded: the app before a session hands off in the same page.
      expect(state.windows[0].loads).toHaveLength(1);
    }, 30_000);

    it('stops the executor it started when the app quits', async () => {
      const { app } = await import('electron');
      app.quit();
      await until(() => state.quitDone);
      await until(() => pids().every((pid) => !alive(pid)), 5_000);
    }, 30_000);
  },
);
