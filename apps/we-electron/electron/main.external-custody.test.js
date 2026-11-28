/**
 * External executor mode with a custody credential the sidecar cannot take, driven through `main.js`
 * as in `main.custody-token.test.js`.
 *
 * `WE_EXTERNAL_AD4M_CUSTODY_CREDENTIAL` of blanks is set, so `main.js` goes on to start the sidecar;
 * `custodySpawn` refuses a credential that is not one non-blank line and throws. That throw is a
 * custody start failure like a missing binary: identity is off and the app opens its window. Before,
 * it escaped `whenReady` and the app ran on with no window.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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
    errors: [],
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, ms = 10_000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (check()) return;
  throw new Error('timed out waiting');
}

/** A `we-custody` that would run: present and executable, so `main.js` goes on to start it. */
const fakeCustody = `#!${process.execPath}
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
`;

describe.skipIf(process.platform === 'win32')('an external executor with a blank custody credential', () => {
  const rejections = [];
  const onRejection = (reason) => rejections.push(reason);
  let consoleError;

  beforeAll(async () => {
    state.root = mkdtempSync(join(tmpdir(), 'we-external-custody-'));
    const resources = join(state.root, 'resources');
    mkdirSync(resources);
    writeFileSync(join(resources, 'we-custody'), fakeCustody);
    chmodSync(join(resources, 'we-custody'), 0o755);

    process.on('unhandledRejection', onRejection);
    consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => state.errors.push(args.join(' ')));

    process.resourcesPath = resources;
    process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173';
    process.env.WE_EXTERNAL_AD4M_PORT = '12000';
    process.env.WE_EXTERNAL_AD4M_TOKEN = 'external-admin';
    process.env.WE_EXTERNAL_AD4M_CUSTODY_CREDENTIAL = '   ';

    await import('./main.js');
    state.readyResolve();
    await until(() => state.windows.length === 1 || rejections.length > 0).catch(() => {});
  }, 30_000);

  afterAll(async () => {
    process.off('unhandledRejection', onRejection);
    consoleError?.mockRestore();
    delete process.env.WE_EXTERNAL_AD4M_PORT;
    delete process.env.WE_EXTERNAL_AD4M_TOKEN;
    const { app } = await import('electron');
    app.quit();
    await until(() => state.quitDone).catch(() => {});
    if (existsSync(state.root)) rmSync(state.root, { recursive: true, force: true });
  });

  it('opens the window with identity off, as a missing sidecar does', () => {
    expect(rejections.map(String)).toEqual([]);
    expect(state.windows).toHaveLength(1);
    expect(state.windows[0].loads).toHaveLength(1);
    expect(state.errors.some((line) => /custody sidecar could not start.*identity is off/.test(line))).toBe(true);
    // Not a failure of the app: no error box, no quit.
    expect(state.errorBoxes).toEqual([]);
    expect(state.quits).toBe(0);
  });
});
