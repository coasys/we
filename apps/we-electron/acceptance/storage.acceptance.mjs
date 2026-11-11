/**
 * The executor's storage at rest, end to end: the supervisor's unlock (`electron/storageUnlock.js`)
 * against a real `ad4m-executor`, sealed at its start, and the real `we-custody storage-secret`
 * helper. Each case starts the executor as the desktop app does (its API on a free port, the admin
 * credential in its environment) on a data folder of its own, and acts as the identity window would:
 * it reads each screen the supervisor answers and submits what a person would.
 *
 * - A sealed executor opens from the secret the keyring keeps: a first start makes it, a later one
 *   reads the same one back, and no window is opened.
 * - On Linux with no Secret Service at all, the storage passphrase opens it: set at the first start,
 *   asked at the next, and a wrong one is refused in words.
 * - An executor from before at-rest encryption (plaintext language storage) moves its data under its
 *   keys at the first unlock: the window shows how far it is, store by store, and then it opens.
 *
 * Nothing here reaches the person's keyring or session bus. The keyring is a `gnome-keyring-daemon`
 * on a private `dbus-daemon`, both started here with a home folder of their own and stopped after;
 * the no-keyring case points the helper at a bus address where nothing listens. The executor gets a
 * home of its own too.
 *
 * Needs `WE_AD4M_EXECUTOR` (an `ad4m-executor` at the ad4m commit WE pins) and `WE_CUSTODY` (a
 * `we-custody` build); skipped without them. The keyring case also needs `dbus-daemon` and
 * `gnome-keyring-daemon` on the PATH, and is skipped without them.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { executorRpc } from '../electron/mainAgent.js';
import { storageKeystore, unlockStorage, WRONG_STORAGE_PASSPHRASE } from '../electron/storageUnlock.js';

const EXECUTOR = process.env.WE_AD4M_EXECUTOR ?? null;
const CUSTODY = process.env.WE_CUSTODY ?? null;
const CREDENTIAL = 'storage-acceptance-credential';
const START_MS = 60_000;
const PASSPHRASE = 'a storage passphrase for the test only';

const missing = !EXECUTOR || !CUSTODY ? 'needs WE_AD4M_EXECUTOR and WE_CUSTODY' : false;
const onPath = (name) => spawnSync('sh', ['-c', `command -v ${name}`]).status === 0;
const noKeyringDaemon =
  missing ||
  (!onPath('dbus-daemon') || !onPath('gnome-keyring-daemon') ? 'needs dbus-daemon and gnome-keyring-daemon' : false);

const root = mkdtempSync(join(tmpdir(), 'we-storage-acceptance-'));
const running = new Set();

/** A port nothing listens on now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** A child's exit, as a promise that settles once. */
function exited(child) {
  return child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve()
    : new Promise((resolve) => child.once('exit', () => resolve()));
}

async function stop(child) {
  running.delete(child);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  const killed = setTimeout(() => child.kill('SIGKILL'), 10_000);
  await exited(child);
  clearTimeout(killed);
}

/**
 * `ad4m-executor run` on `dataPath`, as the desktop app starts it, with a home of its own and a bus
 * address where nothing listens. Resolves once its API answers, with the admin socket open.
 */
async function startExecutor(dataPath, name) {
  const port = await freePort();
  const home = join(root, `${name}-executor-home`);
  mkdirSync(home, { recursive: true });
  const logFile = join(root, `${name}-executor.log`);
  const child = spawn(
    EXECUTOR,
    [
      'run',
      '--port',
      String(port),
      '--app-data-path',
      dataPath,
      '--run-dapp-server',
      'false',
      '--connect-holochain',
      'false',
    ],
    {
      env: {
        PATH: process.env.PATH,
        HOME: home,
        DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(root, 'nothing-listens')}`,
        AD4M_ADMIN_CREDENTIAL: CREDENTIAL,
        RUST_LOG: 'info',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  running.add(child);
  let log = '';
  const keep = (chunk) => {
    log += String(chunk);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  const deadline = Date.now() + START_MS;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`the executor exited at its start:\n${log.slice(-4000)}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.status < 500) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error(`the executor did not answer in time:\n${log.slice(-4000)}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  const rpc = executorRpc({ port, token: CREDENTIAL, timeoutMs: 30_000 });
  return {
    rpc,
    log: () => log,
    async stop() {
      rpc.close();
      await stop(child);
      writeFileSync(logFile, log);
    },
  };
}

/**
 * A Secret Service of the test's own: a `dbus-daemon` on a socket in the test folder and a
 * `gnome-keyring-daemon` on it, its keyrings under a home of its own, the login keyring made and
 * unlocked with a test password. Answers the environment a helper reaches it with.
 */
async function privateKeyring() {
  const dir = join(root, 'keyring');
  const home = join(dir, 'home');
  const runtime = join(dir, 'run');
  mkdirSync(home, { recursive: true });
  mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const address = `unix:path=${join(dir, 'bus')}`;
  const bus = spawn('dbus-daemon', ['--session', '--nofork', `--address=${address}`, '--print-address'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  running.add(bus);
  await new Promise((resolve, reject) => {
    bus.stdout.once('data', resolve);
    bus.once('exit', () => reject(new Error('the private dbus-daemon did not start')));
  });
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_RUNTIME_DIR: runtime,
    DBUS_SESSION_BUS_ADDRESS: address,
  };
  const daemon = spawn('gnome-keyring-daemon', ['--foreground', '--components=secrets', '--unlock'], {
    env,
    stdio: ['pipe', 'ignore', 'inherit'],
  });
  running.add(daemon);
  daemon.stdin.end('a keyring password for the test only');
  // Up once it owns the Secret Service's name on the private bus.
  const deadline = Date.now() + 20_000;
  for (;;) {
    const owned = spawnSync(
      'dbus-send',
      [
        '--session',
        '--print-reply',
        '--dest=org.freedesktop.DBus',
        '/org/freedesktop/DBus',
        'org.freedesktop.DBus.NameHasOwner',
        'string:org.freedesktop.secrets',
      ],
      { env, encoding: 'utf8' },
    );
    if (owned.stdout?.includes('boolean true')) break;
    if (Date.now() > deadline) throw new Error('the private Secret Service did not start');
    await new Promise((r) => setTimeout(r, 200));
  }
  return {
    env,
    async stop() {
      await stop(daemon);
      await stop(bus);
    },
  };
}

/** Each screen the window was answered, the first one included, as the test drove it. */
async function drive(step, inputs) {
  const shown = [step.first];
  let outcome = null;
  for (const input of inputs) {
    const answer = await step.submit(typeof input === 'function' ? input(shown.at(-1)) : input);
    shown.push(answer);
    outcome = answer.outcome;
    if (outcome) break;
  }
  return { shown, outcome };
}

/**
 * The open storage's stores: each is under its key, but the links, which the executor keeps in
 * plaintext still at the commit WE pins, so `encryptedAtRest` stays false (the settings page's
 * storage line says so in words).
 */
function assertUnderKeys(status) {
  assert.deepEqual(status.stores, { database: 'encrypted', languageStorage: 'encrypted', links: 'plain' });
  assert.equal(status.secretOnDataDisk, false);
}

const noWindow = () => {
  throw new Error('no window is opened where the keyring keeps the secret');
};

after(async () => {
  for (const child of [...running]) await stop(child);
});

describe('a sealed executor opens from the secret the keyring keeps', { skip: noKeyringDaemon }, () => {
  let keyring;
  before(async () => {
    keyring = await privateKeyring();
  });
  after(async () => {
    await keyring?.stop();
  });

  it('makes the secret at the first start and reads the same one back at the next', async () => {
    const dataPath = join(root, 'keyring-data');
    const keystore = storageKeystore({ binary: CUSTODY, dataFolder: dataPath, baseEnv: keyring.env });

    const first = await startExecutor(dataPath, 'keyring-first');
    try {
      assert.equal((await first.rpc.call('runtime.storageStatus')).state, 'sealed');
      const opened = await unlockStorage({
        call: first.rpc.call,
        onEvent: first.rpc.onEvent,
        keystore,
        firstStart: true,
        askPassphrase: noWindow,
        log: () => {},
      });
      assert.equal(opened.how, 'keyring');
      assert.equal(opened.status.state, 'open');
      assertUnderKeys(opened.status);
      assert.equal(opened.status.secretOnDataDisk, false);
    } finally {
      await first.stop();
    }

    const again = await startExecutor(dataPath, 'keyring-again');
    try {
      assert.equal((await again.rpc.call('runtime.storageStatus')).state, 'sealed');
      const opened = await unlockStorage({
        call: again.rpc.call,
        onEvent: again.rpc.onEvent,
        keystore,
        firstStart: false,
        askPassphrase: noWindow,
        log: () => {},
      });
      // A secret made again would not open the keyring the first start made.
      assert.equal(opened.how, 'keyring');
      assert.equal(opened.status.state, 'open');
    } finally {
      await again.stop();
    }
    // The secret rests in the keyring, never in the data folder.
    const files = readdirSync(dataPath, { recursive: true }).map(String);
    assert.ok(!files.some((file) => /secret/i.test(file)), `no secret file in the data folder: ${files.join(', ')}`);
  });
});

describe('the storage passphrase opens it where Linux has no Secret Service', { skip: missing }, () => {
  it('sets the passphrase at the first start, refuses a wrong one, and opens with it at the next', async () => {
    const dataPath = join(root, 'passphrase-data');
    const env = {
      PATH: process.env.PATH,
      HOME: join(root, 'passphrase-home'),
      DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(root, 'nothing-listens')}`,
    };
    const keystore = storageKeystore({ binary: CUSTODY, dataFolder: dataPath, baseEnv: env });

    const first = await startExecutor(dataPath, 'passphrase-first');
    try {
      let driven;
      const opened = await unlockStorage({
        call: first.rpc.call,
        onEvent: first.rpc.onEvent,
        keystore,
        firstStart: true,
        askPassphrase: async (step) => {
          driven = await drive(step, [
            { kind: 'passphrase', passphrase: PASSPHRASE, confirm: 'not the same words' },
            { kind: 'passphrase', passphrase: PASSPHRASE, confirm: PASSPHRASE },
            { kind: 'wait-storage' },
            { kind: 'wait-storage' },
          ]);
          return driven.outcome;
        },
        log: () => {},
      });
      assert.equal(opened.how, 'passphrase');
      assert.equal(opened.status.state, 'open');
      assertUnderKeys(opened.status);
      assert.deepEqual(driven.shown[0].screen, { screen: 'set-storage-passphrase', error: null });
      assert.equal(driven.shown[1].screen.screen, 'set-storage-passphrase');
      assert.ok(driven.shown[1].screen.error, 'two different passphrases are refused in words');
      assert.deepEqual(driven.shown.at(-1), { screen: { screen: 'storage-open' }, outcome: 'done' });
    } finally {
      await first.stop();
    }

    const again = await startExecutor(dataPath, 'passphrase-again');
    try {
      let driven;
      const opened = await unlockStorage({
        call: again.rpc.call,
        onEvent: again.rpc.onEvent,
        keystore,
        firstStart: false,
        askPassphrase: async (step) => {
          driven = await drive(step, [
            { kind: 'passphrase', passphrase: 'not the passphrase' },
            { kind: 'passphrase', passphrase: PASSPHRASE },
            { kind: 'wait-storage' },
          ]);
          return driven.outcome;
        },
        log: () => {},
      });
      assert.equal(opened.how, 'passphrase');
      assert.equal(opened.status.state, 'open');
      assert.deepEqual(driven.shown[0].screen, { screen: 'unlock-storage', error: null });
      assert.deepEqual(driven.shown[1].screen, { screen: 'unlock-storage', error: WRONG_STORAGE_PASSPHRASE });
      assert.deepEqual(driven.shown.at(-1), { screen: { screen: 'storage-open' }, outcome: 'done' });
    } finally {
      await again.stop();
    }
  });
});

/**
 * A data folder as an executor from before at-rest encryption left it: languages with plaintext
 * storage files beside their bundles, enough of them that moving them takes a moment.
 */
function plaintextExecutorFolder(dataPath, { languages = 40, filesEach = 500 } = {}) {
  const contents = [];
  for (let l = 0; l < languages; l++) {
    const folder = join(dataPath, 'ad4m', 'languages', `QmPlaintextLanguage${String(l).padStart(4, '0')}`);
    mkdirSync(join(folder, 'storage'), { recursive: true });
    for (let f = 0; f < filesEach; f++) {
      const file = join(folder, 'storage', `item-${f}.json`);
      const content = JSON.stringify({ language: l, item: f, text: 'test data only '.repeat(8) });
      writeFileSync(file, content);
      contents.push({ file, content });
    }
  }
  return contents;
}

describe('an executor from before at-rest encryption moves its data under its keys', { skip: noKeyringDaemon }, () => {
  let keyring;
  before(async () => {
    keyring = await privateKeyring();
  });
  after(async () => {
    await keyring?.stop();
  });

  it('shows how far the move is, store by store, then opens with nothing left in plaintext', async () => {
    const dataPath = join(root, 'plaintext-data');
    const plaintext = plaintextExecutorFolder(dataPath);
    const keystore = storageKeystore({ binary: CUSTODY, dataFolder: dataPath, baseEnv: keyring.env });

    const executor = await startExecutor(dataPath, 'plaintext');
    try {
      let driven = null;
      const opened = await unlockStorage({
        call: executor.rpc.call,
        onEvent: executor.rpc.onEvent,
        keystore,
        firstStart: true,
        askPassphrase: noWindow,
        showMigration: async (step) => {
          const inputs = Array.from({ length: 1000 }, () => ({ kind: 'wait-storage' }));
          driven = await drive(step, inputs);
          return driven.outcome;
        },
        log: () => {},
      });
      assert.equal(opened.how, 'keyring');
      assert.equal(opened.status.state, 'open');
      assertUnderKeys(opened.status);

      assert.ok(
        driven,
        `the window showed the move (the executor said: ${executor.log().match(/Moving[^\n]*/)?.[0] ?? 'nothing of it'})`,
      );
      const progress = driven.shown.slice(0, -1).map((answer) => answer.screen);
      assert.ok(progress.length >= 1);
      for (const screen of progress) {
        assert.equal(screen.screen, 'storage-migrating');
        assert.ok(screen.storesDone <= screen.storesTotal || screen.storesTotal === 0, JSON.stringify(screen));
      }
      const done = progress.map((screen) => screen.storesDone);
      assert.deepEqual(
        done,
        [...done].sort((a, b) => a - b),
        'the count only goes forward',
      );
      assert.deepEqual(driven.shown.at(-1), { screen: { screen: 'storage-open' }, outcome: 'done' });
    } finally {
      await executor.stop();
    }
    // Every plaintext file is sealed now: none of them reads as what was written.
    const left = plaintext.filter(({ file, content }) => {
      try {
        return readFileSync(file, 'utf8') === content;
      } catch {
        return false;
      }
    });
    assert.equal(left.length, 0, `${left.length} files are still in plaintext`);
  });
});
