/**
 * The executor's storage, unlocked by the supervisor (`storageUnlock.js`) through `main.js` as in
 * `main.main-agent.test.js`: the fake executor starts sealed and answers `runtime.storageStatus` and
 * `storage.unlock` (`fixtures/fake-executor.cjs`), and a fake `we-custody` answers `storage-secret`
 * from a keyring that is a file (`fixtures/fake-custody.cjs`).
 *
 * Scenario: a first start makes the storage secret in the keyring and opens the executor with it,
 * before the main agent; a restart reads the same secret. With the keyring locked, or keeping a
 * secret that does not open the data, the start fails in words with no path and no secret, and the
 * agent is never asked for. With no keyring, the identity window asks for the storage passphrase: a
 * wrong one is asked again, and closing the window fails the start. A folder with no keys yet, and no
 * keyring, is given a new storage passphrase there, and opens with it. No secret and no passphrase is
 * in any file the app writes.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { IDENTITY_PAGE } from './identityWindow.js';
import { storageFailure, WRONG_STORAGE_PASSPHRASE } from './storageUnlock.js';

const state = vi.hoisted(() => {
  const s = {
    handlers: {},
    ipc: {},
    windows: [],
    quits: 0,
    quitDone: false,
    messageBoxes: [],
    errorBoxes: [],
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
      this.events = {};
      this.webContents = {
        mainFrame: { processId: 1, routingId: state.windows.length + 1 },
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
    on(event, fn) {
      (this.events[event] ??= []).push(fn);
    }
    once() {}
    close() {
      if (this.destroyed) return;
      this.destroyed = true;
      for (const fn of this.events.closed ?? []) fn();
    }
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
const keyringFile = () => join(state.root, 'keyring.json');
const executorKeyring = () => join(dataDir(), 'ad4m', 'keyring.json');
const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');
const executorLog = () => read(join(dataDir(), 'fake-executor.log'));
const storageLog = () => read(`${keyringFile()}.storage.log`).split('\n').filter(Boolean);
const keyring = () => JSON.parse(read(keyringFile()) || '{"state":"open","items":{},"storage":{}}');
const setKeyring = (change) => writeFileSync(keyringFile(), JSON.stringify({ ...keyring(), ...change }));
const keptSecret = () => Object.values(keyring().storage ?? {})[0];
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
/** The number of the executor's latest start. */
const lastStart = () => pids().length;

const fromWindow = () => ({
  sender: state.windows[0].webContents,
  senderFrame: { ...state.windows[0].webContents.mainFrame, url: 'http://localhost:5173/', parent: null },
});
const ask = (channel, ...args) => state.ipc[channel](fromWindow(), ...args);

/** The identity window, once one is open on its page. */
const identityWindow = () => state.windows.find((w) => !w.destroyed && w.loads.includes(IDENTITY_PAGE));
const fromIdentity = () => {
  const win = identityWindow();
  return { sender: win.webContents, senderFrame: { ...win.webContents.mainFrame, url: IDENTITY_PAGE, parent: null } };
};
const askIdentity = (channel, ...args) => state.ipc[channel](fromIdentity(), ...args);

/** Waits for the window to hear an end to the start under way: ready or failed. */
async function settled(after) {
  await until(
    () => state.executorStates.length > after && ['ready', 'failed'].includes(state.executorStates.at(-1)?.phase),
  );
  return state.executorStates.at(-1);
}

/** Everything the app wrote to its data folder, logs included; not the fake executor's own keyring. */
function everythingWritten(dir = dataDir()) {
  let text = '';
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) text += everythingWritten(path);
    else if (path !== executorKeyring() && entry.name !== 'fake-executor.agent.json')
      text += readFileSync(path, 'utf8');
  }
  return text;
}

describe.skipIf(process.platform === 'win32' || !existsSync(join(here, 'seed-csp.json')))(
  'the supervisor opens the executor’s sealed storage before anything else of a start',
  () => {
    beforeAll(async () => {
      state.root = mkdtempSync(join(tmpdir(), 'we-storage-'));
      const resources = join(state.root, 'resources');
      mkdirSync(resources);
      mkdirSync(dataDir());
      for (const [from, to] of [
        ['fake-executor.cjs', 'ad4m-executor'],
        ['fake-custody.cjs', 'we-custody'],
      ]) {
        writeFileSync(
          join(resources, to),
          `#!${process.execPath}\n${readFileSync(join(here, 'fixtures', from), 'utf8')}`,
        );
        chmodSync(join(resources, to), 0o755);
      }
      writeFileSync(join(resources, 'ws-lite.cjs'), readFileSync(join(here, 'fixtures', 'ws-lite.cjs')));
      // Sealed at every start.
      writeFileSync(join(dataDir(), 'fake-executor.plan.json'), JSON.stringify({ steps: [] }));

      process.resourcesPath = resources;
      process.env.WE_AD4M_DATA_PATH = dataDir();
      process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173';
      process.env.FAKE_KEYRING = keyringFile();
      delete process.env.WE_EXTERNAL_AD4M_PORT;
      delete process.env.WE_EXTERNAL_AD4M_TOKEN;

      await import('./main.js');
      state.readyResolve();
    }, 60_000);

    afterAll(async () => {
      delete process.env.FAKE_KEYRING;
      const { app } = await import('electron');
      app.quit();
      await until(() => state.quitDone).catch(() => {});
      await sleep(300);
      for (const pid of pids()) if (alive(pid)) process.kill(pid, 'SIGKILL');
      rmSync(state.root, { recursive: true, force: true });
    });

    it('on a first start makes the secret, opens the executor with it, then makes the agent', async () => {
      const ready = await settled(0);
      expect(ready.phase).toBe('ready');
      expect(storageLog()).toEqual(['make open']);
      const log = executorLog();
      expect(log).toMatch(/^1 storage unlocked$/m);
      // The storage first: until it is open the executor answers nothing else.
      expect(log.indexOf('1 storage unlocked')).toBeLessThan(log.indexOf('1 agent generated'));
      expect(log).not.toMatch(/storage-sealed|unlock refused/);
      const secret = keptSecret();
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
      // The executor's keyring was made with the secret the keyring keeps.
      expect(JSON.parse(read(executorKeyring())).secret).toBe(secret);
      expect(everythingWritten()).not.toContain(secret);
    });

    it('on a restart reads the same secret, and makes no new one', async () => {
      const secret = keptSecret();
      const before = state.executorStates.length;
      await ask('executor-restart');
      expect((await settled(before)).phase).toBe('ready');
      expect(storageLog()).toEqual(['make open', 'read open']);
      expect(executorLog()).toMatch(new RegExp(`^${lastStart()} storage unlocked$`, 'm'));
      expect(keptSecret()).toBe(secret);
      expect(Object.keys(keyring().storage)).toHaveLength(1);
    }, 30_000);

    it('tells the window how the open storage is kept, and nothing of its keyring', async () => {
      expect(await ask('executor-storage-status')).toEqual({
        state: 'open',
        encryptedAtRest: false,
        stores: { database: 'encrypted', languageStorage: 'encrypted', links: 'plain' },
      });
    });

    it('with the keyring locked, fails the start in words, and asks nothing of the agent', async () => {
      setKeyring({ state: 'locked' });
      const before = state.executorStates.length;
      await ask('executor-restart');
      const failed = await settled(before);
      expect(failed).toEqual({ phase: 'failed', reason: expect.stringContaining(storageFailure('locked')) });
      expect(failed.reason).not.toContain(state.root);
      expect(storageLog().at(-1)).toBe('read locked');
      const n = lastStart();
      expect(executorLog()).not.toMatch(new RegExp(`^${n} (storage unlocked|agent )`, 'm'));
      // Nothing is said of a storage that did not open.
      expect(await ask('executor-storage-status')).toBeNull();
    }, 30_000);

    it('with a kept secret that does not open the data, fails in words with no secret anywhere', async () => {
      const right = keptSecret();
      const wrong = 'c3'.repeat(32);
      setKeyring({ state: 'open', storage: { [dataDir()]: wrong } });
      const before = state.executorStates.length;
      await ask('executor-start');
      const failed = await settled(before);
      expect(failed).toEqual({ phase: 'failed', reason: expect.stringContaining(storageFailure('wrong')) });
      expect(failed.reason).not.toContain(wrong);
      expect(executorLog()).toMatch(new RegExp(`^${lastStart()} storage unlock refused$`, 'm'));
      expect(everythingWritten()).not.toContain(wrong);

      // "Try again" with the right one kept.
      setKeyring({ storage: { [dataDir()]: right } });
      const again = state.executorStates.length;
      await ask('executor-start');
      expect((await settled(again)).phase).toBe('ready');
      expect(executorLog()).toMatch(new RegExp(`^${lastStart()} storage unlocked$`, 'm'));
    }, 30_000);

    it('with no keyring, asks for the storage passphrase in the identity window, again while it is wrong', async () => {
      setKeyring({ state: 'absent' });
      const before = state.executorStates.length;
      // The restart answers once its start has ended, which waits on the window.
      const restarted = ask('executor-restart');
      await until(() => identityWindow());
      expect(await askIdentity('identity-flow-start')).toEqual({ screen: 'unlock-storage', error: null });
      const tried = 'a passphrase that opens nothing';
      expect(await askIdentity('identity-flow-step', { kind: 'passphrase', passphrase: tried })).toEqual({
        screen: 'unlock-storage',
        error: WRONG_STORAGE_PASSPHRASE,
      });
      expect(storageLog().slice(-2)).toEqual(['read absent', 'derive']);
      expect(executorLog()).toMatch(new RegExp(`^${lastStart()} storage unlock refused$`, 'm'));
      // The main window cannot answer it.
      expect(() => ask('identity-flow-step', { kind: 'passphrase', passphrase: tried })).toThrow(/refused/);

      // Closed: the data stays shut, and the start fails in words.
      await askIdentity('identity-flow-cancel');
      await restarted;
      const failed = await settled(before);
      expect(failed).toEqual({ phase: 'failed', reason: expect.stringContaining(storageFailure('cancelled')) });
      expect(everythingWritten()).not.toContain(tried);
    }, 30_000);

    it('with no keyring and no keys yet, opens a new folder with a new storage passphrase', async () => {
      // As a folder no secret has opened: the executor has no keyring file, and no agent (whose
      // passphrase the absent keyring would keep, and so fail the start after the storage opened).
      rmSync(executorKeyring());
      rmSync(join(dataDir(), 'fake-executor.agent.json'), { force: true });
      rmSync(join(dataDir(), 'we-agent-passphrase-kept'), { force: true });
      const passphrase = 'a new storage passphrase, long enough';
      const before = state.executorStates.length;
      await ask('executor-start');
      await until(() => identityWindow());
      expect(await askIdentity('identity-flow-start')).toEqual({ screen: 'set-storage-passphrase', error: null });
      expect(
        await askIdentity('identity-flow-step', { kind: 'passphrase', passphrase: 'too short', confirm: 'too short' }),
      ).toEqual({ screen: 'set-storage-passphrase', error: 'Use at least 15 characters. Spaces count.' });
      expect(await askIdentity('identity-flow-step', { kind: 'passphrase', passphrase, confirm: passphrase })).toEqual({
        screen: 'storage-open',
      });
      // The data is open: the window closes itself, and the start goes on.
      await until(() => !identityWindow());
      expect((await settled(before)).phase).toBe('ready');
      expect(executorLog()).toMatch(new RegExp(`^${lastStart()} storage unlocked$`, 'm'));
      // A first start asks to make the secret; with no keyring to keep it in, nothing was kept.
      expect(storageLog().slice(-3)).toEqual(['make absent', 'derive', 'derive']);
      expect(Object.keys(keyring().storage)).toHaveLength(1);
      expect(everythingWritten()).not.toContain(passphrase);

      // The next start asks for it, and it opens the data.
      const next = state.executorStates.length;
      const restarted = ask('executor-restart');
      await until(() => identityWindow());
      expect(await askIdentity('identity-flow-start')).toEqual({ screen: 'unlock-storage', error: null });
      expect(await askIdentity('identity-flow-step', { kind: 'passphrase', passphrase })).toEqual({
        screen: 'storage-open',
      });
      await restarted;
      expect((await settled(next)).phase).toBe('ready');
    }, 30_000);
  },
);
