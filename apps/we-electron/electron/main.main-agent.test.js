/**
 * The supervisor's main agent (`mainAgent.js`), driven through `main.js` as in
 * `main.executor-failed.test.js`: the fake executor answers the agent calls
 * (`fixtures/fake-executor.cjs`), and a fake `we-custody` answers `wallet-passphrase` from a keyring
 * that is a file (`fixtures/fake-custody.cjs`).
 *
 * Scenario: a first start keeps a new passphrase in the keyring and makes the agent with it; the
 * window hears the executor is ready with its agent unlocked. A restart reads the passphrase and
 * unlocks the agent, with no new one made. With the keyring locked, and then with none, the start of
 * that agent (its passphrase kept in the keyring) fails, and the window is told why in words with no
 * path and no secret; "Try again" once the keyring is open unlocks it. With no keyring on a first
 * start, or for an agent made before the keyring, the window is asked for the WE password
 * (`executor-agent-password`), which makes or unlocks the agent; a wrong one is answered wrong. The
 * passphrase and the password are in no log the app writes.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AGENT_PASSWORD_MAX, executorRpc, KEYRING_WORDS, NEW_AGENT_KEYRING_WORDS } from './mainAgent.js';

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
const keyringFile = () => join(state.root, 'keyring.json');
const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');
const executorLog = () => read(join(dataDir(), 'fake-executor.log'));
const keyringLog = () => read(`${keyringFile()}.log`).split('\n').filter(Boolean);
const keyring = () => JSON.parse(read(keyringFile()) || '{"state":"open","items":{}}');
const setKeyring = (state_) => writeFileSync(keyringFile(), JSON.stringify({ ...keyring(), state: state_ }));
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

const fromWindow = () => ({
  sender: state.windows[0].webContents,
  senderFrame: { ...state.windows[0].webContents.mainFrame, url: 'http://localhost:5173/', parent: null },
});
const ask = (channel, ...args) => state.ipc[channel](fromWindow(), ...args);

/** Waits for the window to hear an end to the start under way: ready or failed. */
async function settled(after) {
  await until(
    () => state.executorStates.length > after && ['ready', 'failed'].includes(state.executorStates.at(-1)?.phase),
  );
  return state.executorStates.at(-1);
}

/** Everything the app wrote to its data folder, logs included. */
function everythingWritten(dir = dataDir()) {
  let text = '';
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) text += everythingWritten(path);
    else if (entry.name !== 'fake-executor.agent.json') text += readFileSync(path, 'utf8');
  }
  return text;
}

describe.skipIf(process.platform === 'win32' || !existsSync(join(here, 'seed-csp.json')))(
  'the supervisor makes and unlocks the main agent with a passphrase the keyring keeps',
  () => {
    beforeAll(async () => {
      state.root = mkdtempSync(join(tmpdir(), 'we-main-agent-'));
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
      // Each start's storage is open, so the keyring answers only for the agent here; the storage
      // step before it is `main.storage.test.js`'s.
      writeFileSync(join(dataDir(), 'fake-executor.plan.json'), JSON.stringify({ steps: [], storage: 'open' }));

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

    it('on a first start keeps a new passphrase, then makes the agent with it', async () => {
      const ready = await settled(0);
      expect(ready).toEqual({ phase: 'ready', agent: 'unlocked' });
      expect(await ask('executor-state')).toEqual({ phase: 'ready', agent: 'unlocked' });
      expect(keyringLog()).toEqual(['make open']);
      expect(executorLog()).toMatch(/^1 agent generated$/m);
      // One item, for this data folder, holding the passphrase the agent was made with.
      const items = Object.values(keyring().items);
      expect(items).toHaveLength(1);
      const made = JSON.parse(read(join(dataDir(), 'fake-executor.agent.json'))).passphrase;
      expect(made).toBe(items[0]);
      expect(everythingWritten()).not.toContain(made);
    });

    it('on a restart reads the kept passphrase and unlocks the agent, with no prompt and no new passphrase', async () => {
      const before = state.executorStates.length;
      await ask('executor-restart');
      expect(await settled(before)).toEqual({ phase: 'ready', agent: 'unlocked' });
      expect(keyringLog()).toEqual(['make open', 'read open']);
      expect(executorLog()).toMatch(/^2 agent unlocked$/m);
      expect(executorLog()).not.toMatch(/agent unlock refused/);
      expect(Object.values(keyring().items)).toHaveLength(1);
    }, 30_000);

    for (const [keyringState, refused] of [
      ['locked', 'locked'],
      ['absent', 'unavailable'],
    ]) {
      it(`with the keyring ${keyringState}, fails the start in words with no path and no secret`, async () => {
        const passphrase = Object.values(keyring().items)[0];
        setKeyring(keyringState);
        const before = state.executorStates.length;
        await ask('executor-restart');
        const failed = await settled(before);
        expect(failed.phase).toBe('failed');
        expect(failed.reason).toContain(KEYRING_WORDS[refused]);
        expect(failed.reason).not.toContain(state.root);
        expect(failed.reason).not.toContain(passphrase);
        expect(failed.reason).not.toMatch(/Secret Service on this bus/);
        expect(keyringLog().at(-1)).toBe(`read ${keyringState}`);
        expect(everythingWritten()).not.toContain(passphrase);
      }, 30_000);
    }

    it('unlocks it on "Try again" once the keyring is open', async () => {
      setKeyring('open');
      const before = state.executorStates.length;
      expect(await ask('executor-start')).toEqual({ phase: 'starting' });
      expect(await settled(before)).toEqual({ phase: 'ready', agent: 'unlocked' });
      expect(keyringLog().at(-1)).toBe('read open');
      expect(executorLog().match(/agent generated/g)).toHaveLength(1);
    }, 30_000);

    /*
      Lal's review of #438: `agent` was the start's snapshot, so an agent WE's sign-in unlocked stayed
      `locked` to the window, and the base app's doors stayed shut when the person came back to it.
      Asking for the executor's state reads the agent again.
    */
    it('says the agent is unlocked once sign-in has unlocked it, when the window asks again', async () => {
      // Nothing kept for it: as for an agent made with a WE password.
      writeFileSync(keyringFile(), JSON.stringify({ state: 'open', items: {} }));
      const before = state.executorStates.length;
      await ask('executor-restart');
      expect(await settled(before)).toEqual({ phase: 'ready', agent: 'locked' });
      expect(await ask('executor-state')).toEqual({ phase: 'ready', agent: 'locked' });

      // WE's sign-in, on the executor's own API.
      const rpc = executorRpc({ port: await ask('get-port'), token: await ask('get-token'), timeoutMs: 5_000 });
      try {
        const { passphrase } = JSON.parse(read(join(dataDir(), 'fake-executor.agent.json')));
        expect((await rpc.call('agent.unlock', { passphrase, holochain: true })).isUnlocked).toBe(true);
      } finally {
        rpc.close();
      }

      expect(await ask('executor-state')).toEqual({ phase: 'ready', agent: 'unlocked' });
      // And told to the window, as every change is.
      expect(state.executorStates.at(-1)).toEqual({ phase: 'ready', agent: 'unlocked' });
    }, 30_000);

    /*
      Lal's review of #438 at e4d38fc84: two reads of the agent in flight at once, the older answering
      last, told the window what was true before the newer one. Only the newest read is told.
    */
    it('tells the window the newest read of the agent, not an older one that answers last', async () => {
      const before = state.executorStates.length;
      await ask('executor-restart');
      expect(await settled(before)).toEqual({ phase: 'ready', agent: 'locked' });
      const rpc = executorRpc({ port: await ask('get-port'), token: await ask('get-token'), timeoutMs: 5_000 });
      try {
        const { passphrase } = JSON.parse(read(join(dataDir(), 'fake-executor.agent.json')));
        expect((await rpc.call('agent.unlock', { passphrase, holochain: true })).isUnlocked).toBe(true);
        // The older read: it finds the agent unlocked, and its answer is held back.
        writeFileSync(join(dataDir(), 'fake-executor.status-delay'), '1500');
        const older = ask('executor-state');
        await until(() => /agent status delayed/.test(executorLog()));
        // Locked again before it lands; the newer read finds that, which is what the window knows.
        expect((await rpc.call('agent.lock')).isUnlocked).toBe(false);
        expect(await ask('executor-state')).toEqual({ phase: 'ready', agent: 'locked' });
        await older;
      } finally {
        rpc.close();
      }
      expect(state.executorStates.at(-1)).toEqual({ phase: 'ready', agent: 'locked' });
      expect(await ask('executor-state')).toEqual({ phase: 'ready', agent: 'locked' });
    }, 30_000);

    /*
      Lal's review of #438 at e4d38fc84: an agent made with the WE password is that password's for
      good, so a keyring that is there but locked (or its prompt dismissed) fails a first start, and
      "Try again" asks it again. Only no keyring at all gives the WE password (below).
    */
    it('with the keyring locked on a first start, fails in words and makes the agent on "Try again"', async () => {
      rmSync(join(dataDir(), 'fake-executor.agent.json'), { force: true });
      rmSync(join(dataDir(), 'we-agent-passphrase-kept'), { force: true });
      writeFileSync(keyringFile(), JSON.stringify({ state: 'locked', items: {} }));
      const generated = executorLog().match(/agent generated/g).length;
      const before = state.executorStates.length;
      await ask('executor-restart');
      const failed = await settled(before);
      expect(failed).toEqual({ phase: 'failed', reason: expect.stringContaining(NEW_AGENT_KEYRING_WORDS.locked) });
      expect(failed.reason).not.toContain(state.root);
      expect(keyringLog().at(-1)).toBe('make locked');
      expect(executorLog().match(/agent generated/g)).toHaveLength(generated);
      expect(await ask('executor-agent-password', 'test-password-for-the-agent')).toBe('refused');

      setKeyring('open');
      const again = state.executorStates.length;
      expect(await ask('executor-start')).toEqual({ phase: 'starting' });
      expect(await settled(again)).toEqual({ phase: 'ready', agent: 'unlocked' });
      expect(keyringLog().at(-1)).toBe('make open');
      expect(executorLog().match(/agent generated/g)).toHaveLength(generated + 1);
      const kept = Object.values(keyring().items);
      expect(kept).toHaveLength(1);
      expect(JSON.parse(read(join(dataDir(), 'fake-executor.agent.json'))).passphrase).toBe(kept[0]);
      expect(existsSync(join(dataDir(), 'we-agent-passphrase-kept'))).toBe(true);
    }, 30_000);

    /*
      A desktop with no keyring the app can use (Josh, 10 Nov: option 2). The WE password stands in
      for the kept passphrase: the window is told the agent needs it, and sends it on
      `executor-agent-password`, once. It is in no file and no log the app writes.
    */
    const PASSWORD = 'test-password-for-the-agent';

    it('with no keyring on a first start, asks for a new WE password and makes the agent with it', async () => {
      // A new computer: no agent, nothing noted as kept.
      rmSync(join(dataDir(), 'fake-executor.agent.json'), { force: true });
      rmSync(join(dataDir(), 'we-agent-passphrase-kept'), { force: true });
      writeFileSync(keyringFile(), JSON.stringify({ state: 'absent', items: {} }));
      const generated = executorLog().match(/agent generated/g).length;
      const before = state.executorStates.length;
      await ask('executor-restart');
      expect(await settled(before)).toEqual({ phase: 'ready', agent: 'needs-new-password' });
      expect(executorLog().match(/agent generated/g)).toHaveLength(generated);
      // Asked again, it is still the password that is due.
      expect(await ask('executor-state')).toEqual({ phase: 'ready', agent: 'needs-new-password' });

      // A new password has a floor and a ceiling: neither makes the agent, and it is still asked for.
      for (const odd of ['seven77', 'x'.repeat(AGENT_PASSWORD_MAX + 1)]) {
        expect(await ask('executor-agent-password', odd)).toBe('refused');
      }
      expect(executorLog().match(/agent generated/g)).toHaveLength(generated);
      expect(await ask('executor-state')).toEqual({ phase: 'ready', agent: 'needs-new-password' });

      expect(await ask('executor-agent-password', PASSWORD)).toBe('unlocked');
      expect(state.executorStates.at(-1)).toEqual({ phase: 'ready', agent: 'unlocked' });
      expect(executorLog().match(/agent generated/g)).toHaveLength(generated + 1);
      expect(JSON.parse(read(join(dataDir(), 'fake-executor.agent.json'))).passphrase).toBe(PASSWORD);
      expect(keyring().items).toEqual({});
      expect(everythingWritten()).not.toContain(PASSWORD);
    }, 30_000);

    it('with no keyring, asks for the WE password of an agent made with one, and asks again when it is wrong', async () => {
      const before = state.executorStates.length;
      await ask('executor-restart');
      expect(await settled(before)).toEqual({ phase: 'ready', agent: 'needs-password' });

      expect(await ask('executor-agent-password', 'not-the-password')).toBe('wrong');
      expect(executorLog()).toMatch(/agent unlock refused/);
      expect(await ask('executor-state')).toEqual({ phase: 'ready', agent: 'needs-password' });

      expect(await ask('executor-agent-password', PASSWORD)).toBe('unlocked');
      expect(state.executorStates.at(-1)).toEqual({ phase: 'ready', agent: 'unlocked' });
      expect(everythingWritten()).not.toContain(PASSWORD);
      expect(everythingWritten()).not.toContain('not-the-password');
    }, 30_000);

    it('takes a password only while one is asked for, and only as text', async () => {
      expect(await ask('executor-agent-password', PASSWORD)).toBe('refused');
      const before = state.executorStates.length;
      await ask('executor-restart');
      expect(await settled(before)).toEqual({ phase: 'ready', agent: 'needs-password' });
      for (const odd of [undefined, '', 42, { passphrase: PASSWORD }, 'x'.repeat(AGENT_PASSWORD_MAX + 1)]) {
        expect(await ask('executor-agent-password', odd)).toBe('refused');
      }
      expect(await ask('executor-state')).toEqual({ phase: 'ready', agent: 'needs-password' });
    }, 30_000);

    it('unlocks an agent made with a short WE password before there was a floor', async () => {
      // Made before the floor: the password it was made with opens it, whatever its length.
      writeFileSync(join(dataDir(), 'fake-executor.agent.json'), JSON.stringify({ passphrase: 'abc' }));
      const before = state.executorStates.length;
      await ask('executor-restart');
      expect(await settled(before)).toEqual({ phase: 'ready', agent: 'needs-password' });
      expect(await ask('executor-agent-password', 'abc')).toBe('unlocked');
      expect(state.executorStates.at(-1)).toEqual({ phase: 'ready', agent: 'unlocked' });
    }, 30_000);
  },
);
