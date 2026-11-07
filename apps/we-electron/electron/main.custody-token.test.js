/**
 * The custody channel's credential, driven through `main.js` as in `main.supervisor.test.js`.
 *
 * The custody sidecar reaches the executor's custody channel with a credential of its own: `main.js`
 * makes it at each start beside the admin credential and writes it as the first line of the
 * executor's stdin and of the sidecar's — never in an argument or an environment, which the
 * renderer's admin credential could read back (`/proc/<pid>/environ`). The main window's `get-token` answers the
 * admin credential, which the executor's custody guard (`identity::custody::admit`) refuses, so
 * nothing running in the main renderer can call `identity.takeMaster` or `identity.claimOffer` with
 * `canKeepMaster`.
 *
 * The sidecar is a fake `we-custody` beside the fake executor (`fixtures/fake-executor.cjs`, which
 * keeps the executor's stdin contract): both record their arguments, environment and first stdin
 * line, and the sidecar answers nothing.
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
const custodyFile = () => join(dataDir(), 'fake-custody.json');
const executorLog = () =>
  existsSync(join(dataDir(), 'fake-executor.log')) ? readFileSync(join(dataDir(), 'fake-executor.log'), 'utf8') : '';
const pids = () =>
  executorLog()
    .split('\n')
    .filter((line) => / start /.test(line))
    .map((line) => Number(line.match(/pid=(\d+)/)[1]));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** An invoke from the main window's top frame on the app's origin, as `ipcSender.js` admits. */
function invoke(channel, ...args) {
  const window = state.windows[0];
  const event = {
    sender: window.webContents,
    senderFrame: { processId: 1, routingId: 1, url: `${process.env.VITE_DEV_SERVER_URL}/` },
  };
  return state.ipc[channel](event, ...args);
}

/**
 * A `we-custody` that reads the first line of its stdin (the credential, as the real one does),
 * writes it with what it was started with, then waits for its stdin to close.
 */
const fakeCustody = (file) => `#!${process.execPath}
const fs = require('fs');
let pending = '';
process.stdin.on('data', (chunk) => {
  if (pending === null) return;
  pending += chunk.toString('utf8');
  const end = pending.indexOf('\\n');
  if (end === -1) return;
  const firstLine = pending.slice(0, end);
  pending = null;
  fs.writeFileSync(${JSON.stringify(file)}, JSON.stringify({ argv: process.argv.slice(2), env: process.env, pid: process.pid, firstLine }));
});
process.stdin.on('end', () => process.exit(0));
`;

/** What the fake executor's first start was started with (`fixtures/fake-executor.cjs`). */
const executorStart = () => JSON.parse(readFileSync(join(dataDir(), 'fake-executor.start-1.json'), 'utf8'));

/** Variables a custody credential could be passed in, which neither child may get. */
const CUSTODY_VARS = /^(AD4M_CUSTODY_CREDENTIAL|WE_EXTERNAL_AD4M_CUSTODY_CREDENTIAL)/;

describe.skipIf(process.platform === 'win32' || !existsSync(join(here, 'seed-csp.json')))(
  'the credential the custody sidecar gets is not the one the main window gets',
  () => {
    beforeAll(async () => {
      state.root = mkdtempSync(join(tmpdir(), 'we-custody-token-'));
      const resources = join(state.root, 'resources');
      mkdirSync(resources);
      mkdirSync(dataDir());
      const fake = `#!${process.execPath}\n${readFileSync(join(here, 'fixtures', 'fake-executor.cjs'), 'utf8')}`;
      writeFileSync(join(resources, 'ad4m-executor'), fake);
      chmodSync(join(resources, 'ad4m-executor'), 0o755);
      writeFileSync(join(resources, 'we-custody'), fakeCustody(custodyFile()));
      chmodSync(join(resources, 'we-custody'), 0o755);
      writeFileSync(join(dataDir(), 'fake-executor.plan.json'), JSON.stringify({ steps: [] }));

      process.resourcesPath = resources;
      process.env.WE_AD4M_DATA_PATH = dataDir();
      process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173';
      delete process.env.WE_EXTERNAL_AD4M_PORT;
      delete process.env.WE_EXTERNAL_AD4M_TOKEN;
      // Inherited by the app, and passed to neither child: the executor would refuse to start (78).
      process.env.AD4M_CUSTODY_CREDENTIAL = 'inherited-custody-credential';
      process.env.AD4M_CUSTODY_CREDENTIAL_FILE = join(state.root, 'inherited-custody-credential');

      await import('./main.js');
      state.readyResolve();
      await until(() => state.windows.length === 1 && state.windows[0].loads.length === 1);
      await until(() => existsSync(custodyFile()));
    }, 60_000);

    afterAll(async () => {
      delete process.env.AD4M_CUSTODY_CREDENTIAL;
      delete process.env.AD4M_CUSTODY_CREDENTIAL_FILE;
      const { app } = await import('electron');
      app.quit();
      await until(() => state.quitDone).catch(() => {});
      await sleep(500);
      for (const pid of pids()) if (alive(pid)) process.kill(pid, 'SIGKILL');
      const custody = existsSync(custodyFile()) ? JSON.parse(readFileSync(custodyFile(), 'utf8')) : null;
      if (custody && alive(custody.pid)) process.kill(custody.pid, 'SIGKILL');
      rmSync(state.root, { recursive: true, force: true });
    });

    it('gives the executor the custody credential as the first line of its stdin, and keeps stdin open', async () => {
      const start = executorStart();
      const custody = JSON.parse(readFileSync(custodyFile(), 'utf8'));
      expect(start.argv).toContain('--custody-channel');
      expect(start.custodyLine).toMatch(/^[0-9a-f-]{36}$/);
      // The same credential the sidecar got: the one the custody channel admits.
      expect(start.custodyLine).toBe(custody.firstLine);
      // Nowhere else: not in the arguments, not in the environment, not inherited from the app.
      expect(start.argv.join(' ')).not.toContain(start.custodyLine);
      expect(Object.keys(start.env).filter((name) => CUSTODY_VARS.test(name))).toEqual([]);
      expect(Object.values(start.env)).not.toContain(start.custodyLine);
      // `--watch-stdin true`: closing the pipe would stop it; it is still open and the executor up.
      expect(executorLog()).toContain('1 custody credential read');
      expect(executorLog()).not.toContain('stdin closed');
      expect(alive(pids()[0])).toBe(true);
    });

    it('starts the sidecar with the custody credential on its stdin, and neither credential in its environment', async () => {
      const custody = JSON.parse(readFileSync(custodyFile(), 'utf8'));
      const port = await invoke('get-port');
      const token = await invoke('get-token');
      expect(custody.argv).toEqual(['--executor-port', String(port)]);
      expect(custody.firstLine).toMatch(/^[0-9a-f-]{36}$/);
      expect(Object.keys(custody.env).filter((name) => CUSTODY_VARS.test(name))).toEqual([]);
      expect(custody.env.AD4M_ADMIN_CREDENTIAL).toBeUndefined();
      expect(Object.values(custody.env)).not.toContain(custody.firstLine);
      expect(Object.values(custody.env)).not.toContain(token);
    });

    it('answers get-token with the admin credential, never the custody credential', async () => {
      const custody = JSON.parse(readFileSync(custodyFile(), 'utf8'));
      const token = await invoke('get-token');
      // The custody channel of ad4m (`identity::custody::admit`) admits only the custody credential
      // on a loopback listener, so the main renderer, with this token, cannot call
      // `identity.takeMaster` and take a master key waiting in this computer's inbox.
      expect(token).toMatch(/^[0-9a-f-]{36}$/);
      expect(token).not.toBe(custody.firstLine);
      expect(executorStart().env.AD4M_ADMIN_CREDENTIAL).toBe(token);
    });
  },
);
