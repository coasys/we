/**
 * The supervisor's storage unlock (`storageUnlock.js`), against a fake executor RPC and a fake
 * keystore: a sealed executor is given the secret the keyring keeps and waited on until open; the
 * secret is made once, on the folder's first start, and read on every start after; a secret that does
 * not open the data, and a keyring that refuses, fail the start in words with no secret in them or in
 * the log; and where there is no keyring the storage passphrase opens it, asked again when wrong.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  followStorage,
  isFirstStart,
  keyringFile,
  MIGRATION_FAILED_PASSPHRASE,
  passphraseStep,
  secretFromLine,
  STORAGE_LOCKED,
  STORAGE_WORDS,
  storageFailure,
  storageKeystore,
  storageShown,
  unlockStorage,
  waitUntilOpen,
  WRONG_STORAGE_PASSPHRASE,
} from './storageUnlock.js';

const here = dirname(fileURLToPath(import.meta.url));
const KEYRING_ID = '00112233445566778899aabbccddeeff';
const SECRET_A = 'a1'.repeat(32);
const SECRET_B = 'b2'.repeat(32);

/**
 * An executor's storage gate as the RPC answers it: sealed until `storage.unlock` is given the
 * secret its keyring was made with (the first secret makes it); `unlockingFor` status reads answer
 * `unlocking` after the unlock before `open`. Records every call.
 */
function fakeExecutor({ keyringSecret = null, open = false, unlockingFor = 0, lastError = null, refuse = null } = {}) {
  const gate = { keyringSecret, open, unlockingFor, lastError };
  const calls = [];
  // A status read counts down the reads that answer `unlocking`; the unlock's own answer does not.
  const status = (read = true) => ({
    state: gate.open ? ((read ? gate.unlockingFor-- : gate.unlockingFor) > 0 ? 'unlocking' : 'open') : 'sealed',
    encryptedAtRest: false,
    stores: gate.open ? { database: 'encrypted', languageStorage: 'encrypted', links: 'plain' } : null,
    keyringId: KEYRING_ID,
    secretSource: gate.open ? 'operator' : null,
    secretOnDataDisk: false,
    rootGeneration: gate.keyringSecret ? 1 : 0,
    lastError: gate.lastError,
  });
  const refused = (code, message) => Object.assign(new Error(message), { refused: true, code });
  return {
    gate,
    calls,
    async call(method, params = {}) {
      calls.push({ method, params });
      if (method === 'runtime.storageStatus') return status();
      if (method === 'storage.unlock') {
        if (refuse) throw refused(refuse, 'refused');
        if (!/^[0-9a-f]{64}$/.test(params.secret)) throw refused(400, 'not 64 hex');
        // As the executor does, the message names nothing of the secret.
        if (gate.keyringSecret && gate.keyringSecret !== params.secret)
          throw refused(403, 'the storage secret does not open this keyring');
        const created = !gate.keyringSecret;
        gate.keyringSecret = params.secret;
        gate.open = true;
        return { status: status(false), fingerprint: 'f', created };
      }
      throw refused(503, 'storage-sealed');
    },
  };
}

/**
 * The keyring item, as `storageKeystore` answers it, over a Map: `kind` is `open`, `locked`,
 * `absent` (no keyring) or `failed`. Every Buffer it hands out is kept, to see it zeroed.
 */
function fakeKeystore({ kind = 'open', secret = null } = {}) {
  const keystore = { kind, item: secret, reads: 0, makes: 0, derives: [], given: [] };
  const hand = (hex) => {
    const buffer = Buffer.from(hex, 'latin1');
    keystore.given.push(buffer);
    return { secret: buffer };
  };
  const refusal = () =>
    keystore.kind === 'absent'
      ? { refused: 'unavailable', reason: 'no Secret Service on this bus' }
      : { refused: keystore.kind };
  return Object.assign(keystore, {
    async read() {
      keystore.reads++;
      if (keystore.kind !== 'open') return refusal();
      return keystore.item ? hand(keystore.item) : { none: true };
    },
    async make() {
      keystore.makes++;
      if (keystore.kind !== 'open') return refusal();
      keystore.item ??= SECRET_A;
      return hand(keystore.item);
    },
    async derive({ keyringId, passphrase, confirm, isNew }) {
      keystore.derives.push({ keyringId, isNew });
      if (isNew && passphrase.length < 15)
        return { refused: 'passphrase', reason: 'Use at least 15 characters. Spaces count.' };
      if (isNew && confirm !== passphrase) return { refused: 'passphrase', reason: 'The two passphrases differ.' };
      // A stand-in for Argon2id: the passphrase, padded to 64 hex characters.
      return hand(Buffer.from(passphrase).toString('hex').padEnd(64, '0').slice(0, 64));
    },
  });
}

/** A log that keeps every line, as the console copied into the executor log would. */
function recordingLog() {
  const lines = [];
  const log = (...parts) => lines.push(parts.map(String).join(' '));
  return { lines, log, text: () => lines.join('\n') };
}

const noWait = { wait: async () => {}, now: () => 0 };

describe('unlockStorage', () => {
  it('opens a sealed executor with the secret the keyring keeps, and waits until it is open', async () => {
    const executor = fakeExecutor({ keyringSecret: SECRET_A, unlockingFor: 2 });
    const keystore = fakeKeystore({ secret: SECRET_A });
    const { log, text } = recordingLog();

    const opened = await unlockStorage({
      call: executor.call,
      keystore,
      firstStart: false,
      askPassphrase: () => {
        throw new Error('no passphrase is asked where the keyring keeps the secret');
      },
      log,
      ...noWait,
    });

    expect(opened.how).toBe('keyring');
    expect(opened.status.state).toBe('open');
    expect(executor.calls.map((c) => c.method)).toEqual([
      'runtime.storageStatus',
      'storage.unlock',
      // Unlocking, unlocking, open.
      'runtime.storageStatus',
      'runtime.storageStatus',
      'runtime.storageStatus',
    ]);
    expect(executor.calls[1].params).toEqual({ secret: SECRET_A });
    // A read, never a make, for a folder that has keys.
    expect([keystore.reads, keystore.makes]).toEqual([1, 0]);
    // The supervisor's copy is zeroed once given.
    expect(keystore.given).toHaveLength(1);
    expect(keystore.given[0].every((byte) => byte === 0)).toBe(true);
    expect(text()).not.toContain(SECRET_A);
  });

  it('makes the secret on the first start only, and reads the same one on every start after', async () => {
    const keystore = fakeKeystore();
    const first = fakeExecutor();
    await unlockStorage({
      call: first.call,
      keystore,
      firstStart: true,
      askPassphrase: null,
      log: () => {},
      ...noWait,
    });
    expect([keystore.reads, keystore.makes]).toEqual([0, 1]);
    // The executor made its keyring with the secret the keyring now keeps.
    expect(first.gate.keyringSecret).toBe(SECRET_A);
    expect(keystore.item).toBe(SECRET_A);

    // The next start: the folder has keys, and the same secret opens them.
    const second = fakeExecutor({ keyringSecret: first.gate.keyringSecret });
    const opened = await unlockStorage({
      call: second.call,
      keystore,
      firstStart: false,
      askPassphrase: null,
      log: () => {},
      ...noWait,
    });
    expect(opened.how).toBe('keyring');
    expect([keystore.reads, keystore.makes]).toEqual([1, 1]);
    expect(second.calls[1].params.secret).toBe(SECRET_A);
  });

  it('asks nothing of an executor that is already open, and needs no keyring for it', async () => {
    const executor = fakeExecutor({ keyringSecret: SECRET_A, open: true });
    const opened = await unlockStorage({ call: executor.call, keystore: null, firstStart: false, ...noWait });
    expect(opened.how).toBe('already');
    expect(executor.calls.map((c) => c.method)).toEqual(['runtime.storageStatus']);
  });

  it('fails a sealed start in words where there is no custody helper', async () => {
    const executor = fakeExecutor({ keyringSecret: SECRET_A });
    await expect(unlockStorage({ call: executor.call, keystore: null, firstStart: false, ...noWait })).rejects.toThrow(
      storageFailure('no-helper'),
    );
    expect(executor.calls.map((c) => c.method)).toEqual(['runtime.storageStatus']);
  });

  it('surfaces a secret that does not open the data in words, and never logs it', async () => {
    const executor = fakeExecutor({ keyringSecret: SECRET_A });
    const keystore = fakeKeystore({ secret: SECRET_B });
    const { log, text } = recordingLog();

    const failed = unlockStorage({
      call: executor.call,
      keystore,
      firstStart: false,
      askPassphrase: null,
      log,
      ...noWait,
    });
    await expect(failed).rejects.toThrow(`${STORAGE_LOCKED} ${STORAGE_WORDS.wrong}`);
    const err = await failed.catch((e) => e);
    expect(err.storage).toBe('wrong');
    expect(err.message).not.toContain(SECRET_B);
    expect(text()).not.toContain(SECRET_B);
    expect(text()).toMatch(/did not open the data/);
    // Zeroed whatever the answer; the executor stays sealed.
    expect(keystore.given[0].every((byte) => byte === 0)).toBe(true);
    expect(executor.gate.open).toBe(false);
  });

  it.each([
    [400, 'on-data-disk'],
    [500, 'corrupt'],
    [418, 'failed'],
  ])('says an unlock refused %i as %s, logging only its code', async (code, why) => {
    const executor = fakeExecutor({ refuse: code });
    const keystore = fakeKeystore({ secret: SECRET_A });
    const { log, text } = recordingLog();
    await expect(
      unlockStorage({ call: executor.call, keystore, firstStart: false, askPassphrase: null, log, ...noWait }),
    ).rejects.toThrow(storageFailure(why));
    expect(text()).toContain(String(code));
    expect(text()).not.toContain(SECRET_A);
    expect(keystore.given[0].every((byte) => byte === 0)).toBe(true);
  });

  it.each([
    ['locked', 'locked'],
    ['failed', 'failed'],
  ])('fails in words where the keyring is %s, and writes nothing to the executor', async (kind, why) => {
    const executor = fakeExecutor({ keyringSecret: SECRET_A });
    const keystore = fakeKeystore({ kind, secret: SECRET_A });
    await expect(
      unlockStorage({
        call: executor.call,
        keystore,
        firstStart: false,
        askPassphrase: null,
        log: () => {},
        ...noWait,
      }),
    ).rejects.toThrow(storageFailure(why));
    expect(executor.calls.map((c) => c.method)).toEqual(['runtime.storageStatus']);
  });

  it('fails in words when the executor reports its keyring file damaged while it waits', async () => {
    const executor = fakeExecutor();
    executor.gate.lastError = 'corrupt-keyring';
    await expect(waitUntilOpen(executor.call, noWait)).rejects.toThrow(storageFailure('corrupt'));
  });

  it('fails in words when the data does not open in time', async () => {
    let t = 0;
    const executor = fakeExecutor({ keyringSecret: SECRET_A, open: true, unlockingFor: 1_000 });
    await expect(
      waitUntilOpen(executor.call, { timeoutMs: 1_000, wait: async () => {}, now: () => (t += 300) }),
    ).rejects.toThrow(storageFailure('timeout'));
  });

  it('with no keyring on a first start, asks for a new storage passphrase salted with the keyring id', async () => {
    const executor = fakeExecutor();
    const keystore = fakeKeystore({ kind: 'absent' });
    const { log, text } = recordingLog();
    const screens = [];
    const passphrase = 'a storage passphrase long enough';

    const opened = await unlockStorage({
      call: executor.call,
      keystore,
      firstStart: true,
      log,
      ...noWait,
      async askPassphrase(step) {
        screens.push(step.first);
        screens.push(await step.submit({ kind: 'passphrase', passphrase: 'too short', confirm: 'too short' }));
        screens.push(await step.submit({ kind: 'passphrase', passphrase, confirm: `${passphrase}!` }));
        const last = await step.submit({ kind: 'passphrase', passphrase, confirm: passphrase });
        screens.push(last);
        return last.outcome;
      },
    });

    expect(opened.how).toBe('passphrase');
    expect(screens.map((s) => s.screen.screen)).toEqual([
      'set-storage-passphrase',
      'set-storage-passphrase',
      'set-storage-passphrase',
      'storage-open',
    ]);
    expect(screens[0].screen.error).toBeNull();
    expect(screens[1].screen.error).toMatch(/at least 15/);
    expect(screens[2].screen.error).toMatch(/differ/);
    expect(screens[3].outcome).toBe('done');
    expect(keystore.derives.every((d) => d.keyringId === KEYRING_ID && d.isNew)).toBe(true);
    // Nothing kept, and no make that would have kept it.
    expect(keystore.item).toBeNull();
    expect(text()).not.toContain(passphrase);
    expect(keystore.given.every((b) => b.every((byte) => byte === 0))).toBe(true);
  });

  it('with no keyring after, asks for the storage passphrase again while it is wrong', async () => {
    const right = 'the passphrase this data is under';
    const made = fakeKeystore({ kind: 'absent' });
    const executor = fakeExecutor({
      keyringSecret: Buffer.from(right).toString('hex').padEnd(64, '0').slice(0, 64),
    });
    const screens = [];
    const opened = await unlockStorage({
      call: executor.call,
      keystore: made,
      firstStart: false,
      log: () => {},
      ...noWait,
      async askPassphrase(step) {
        screens.push(step.first);
        screens.push(await step.submit({ kind: 'passphrase', passphrase: 'not the passphrase at all' }));
        screens.push(await step.submit({ kind: 'text', text: right }));
        const last = await step.submit({ kind: 'passphrase', passphrase: right });
        screens.push(last);
        return last.outcome;
      },
    });
    expect(opened.how).toBe('passphrase');
    expect(screens.map((s) => [s.screen.screen, s.screen.error])).toEqual([
      ['unlock-storage', null],
      ['unlock-storage', WRONG_STORAGE_PASSPHRASE],
      ['unlock-storage', 'Type the passphrase.'],
      ['storage-open', undefined],
    ]);
    expect(made.derives.every((d) => !d.isNew)).toBe(true);
  });

  it('asks the passphrase of a folder with keys and nothing kept for it in a keyring that is there', async () => {
    const executor = fakeExecutor({ keyringSecret: SECRET_A });
    const keystore = fakeKeystore();
    let asked = null;
    await expect(
      unlockStorage({
        call: executor.call,
        keystore,
        firstStart: false,
        log: () => {},
        ...noWait,
        askPassphrase: async (step) => {
          asked = step.first.screen.screen;
          return 'cancelled';
        },
      }),
    ).rejects.toThrow(storageFailure('cancelled'));
    expect(asked).toBe('unlock-storage');
    // Never a new secret over a folder that has keys.
    expect(keystore.makes).toBe(0);
  });
});

describe('passphraseStep', () => {
  it('ends failed, with words, where the passphrase cannot be derived', async () => {
    const executor = fakeExecutor();
    const step = passphraseStep({
      call: executor.call,
      keystore: { derive: async () => ({ refused: 'failed' }) },
      keyringId: KEYRING_ID,
      first: false,
      log: () => {},
    });
    const answer = await step.submit({ kind: 'passphrase', passphrase: 'whatever it is' });
    expect(answer).toEqual({ screen: { screen: 'failed', message: storageFailure('failed') }, outcome: 'failed' });
  });
});

describe('secretFromLine', () => {
  it('reads the 64 hex characters of a secret line, and nothing else', () => {
    const secret = secretFromLine(Buffer.from(`{"secret":"${SECRET_A}"}`));
    expect(secret.toString('latin1')).toBe(SECRET_A);
    expect(secretFromLine(Buffer.from('{"none":true}'))).toBeNull();
    expect(secretFromLine(Buffer.from(`{"secret":"${'zz'.repeat(32)}"}`))).toBeNull();
    expect(secretFromLine(Buffer.from(`{"secret":"${SECRET_A}0"}`))).toBeNull();
    expect(secretFromLine(Buffer.from(`{"secret":"${SECRET_A.slice(2)}"}`))).toBeNull();
  });
});

describe('storageKeystore, through a helper', () => {
  const roots = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  /** The fixture custody helper, run by this Node, with its keyring a file in a temp folder. */
  const setUp = () => {
    const root = mkdtempSync(join(tmpdir(), 'we-storage-keystore-'));
    roots.push(root);
    const binary = join(root, 'we-custody');
    writeFileSync(binary, `#!${process.execPath}\n${readFileSync(join(here, 'fixtures', 'fake-custody.cjs'), 'utf8')}`);
    chmodSync(binary, 0o755);
    const data = join(root, 'data');
    mkdirSync(data);
    const keyring = join(root, 'keyring.json');
    return { root, binary, data, keyring };
  };

  it('makes once and reads the same secret, as a Buffer', async () => {
    const { binary, data, keyring } = setUp();
    const keystore = storageKeystore({
      binary,
      dataFolder: data,
      baseEnv: {
        ...process.env,
        FAKE_KEYRING: keyring,
        AD4M_ADMIN_CREDENTIAL: 'admin',
        AD4M_CUSTODY_CREDENTIAL: 'custody',
      },
    });
    expect(await keystore.read()).toEqual({ none: true });
    const made = await keystore.make();
    expect(Buffer.isBuffer(made.secret)).toBe(true);
    const hex = made.secret.toString('latin1');
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    const read = await keystore.read();
    expect(read.secret.toString('latin1')).toBe(hex);
    expect(readFileSync(`${keyring}.storage.log`, 'utf8')).toBe('read open\nmake open\nread open\n');
  });

  it('gives the helper no credential, and only the arguments that name the folder', async () => {
    const { root, data } = setUp();
    const recording = join(root, 'recording');
    const out = join(root, 'started.json');
    writeFileSync(
      recording,
      `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify({ argv: process.argv.slice(2), env: process.env }));\nprocess.stdout.write('{"none":true}\\n');\n`,
    );
    chmodSync(recording, 0o755);
    const keystore = storageKeystore({
      binary: recording,
      dataFolder: data,
      baseEnv: { ...process.env, AD4M_ADMIN_CREDENTIAL: 'admin', AD4M_CUSTODY_CREDENTIAL: 'custody' },
    });
    expect(await keystore.read()).toEqual({ none: true });
    const started = JSON.parse(readFileSync(out, 'utf8'));
    expect(started.argv).toEqual(['storage-secret', 'read', '--data-folder', data]);
    expect(Object.keys(started.env).filter((name) => /CREDENTIAL/.test(name))).toEqual([]);
  });

  it('answers the keyring refusals the helper prints', async () => {
    const { binary, data, keyring } = setUp();
    const keystore = storageKeystore({ binary, dataFolder: data, baseEnv: { ...process.env, FAKE_KEYRING: keyring } });
    writeFileSync(keyring, JSON.stringify({ state: 'locked' }));
    expect(await keystore.make()).toEqual({ refused: 'locked' });
    writeFileSync(keyring, JSON.stringify({ state: 'absent' }));
    expect((await keystore.read()).refused).toBe('unavailable');
  });

  it('derives from a passphrase on stdin, held to the rules for a new one', async () => {
    const { binary, data, keyring } = setUp();
    const keystore = storageKeystore({ binary, dataFolder: data, baseEnv: { ...process.env, FAKE_KEYRING: keyring } });
    const passphrase = 'a storage passphrase long enough';
    expect(
      await keystore.derive({ keyringId: KEYRING_ID, passphrase: 'short', confirm: 'short', isNew: true }),
    ).toEqual({
      refused: 'passphrase',
      reason: 'Use at least 15 characters. Spaces count.',
    });
    const one = await keystore.derive({ keyringId: KEYRING_ID, passphrase, confirm: passphrase, isNew: true });
    const two = await keystore.derive({ keyringId: KEYRING_ID, passphrase, isNew: false });
    expect(one.secret.toString('latin1')).toBe(two.secret.toString('latin1'));
  });

  it('is failed where the helper does not start or prints no answer', async () => {
    const { root, data } = setUp();
    const missing = storageKeystore({ binary: join(root, 'nowhere'), dataFolder: data });
    expect((await missing.read()).refused).toBe('failed');
    const silent = join(root, 'silent');
    writeFileSync(silent, `#!${process.execPath}\nprocess.exit(0);\n`);
    chmodSync(silent, 0o755);
    expect((await storageKeystore({ binary: silent, dataFolder: data }).read()).refused).toBe('failed');
  });

  it('is locked where the helper takes too long (a keyring prompt nobody answered)', async () => {
    const { root, data } = setUp();
    const slow = join(root, 'slow');
    writeFileSync(slow, `#!${process.execPath}\nsetTimeout(() => {}, 60000);\n`);
    chmodSync(slow, 0o755);
    expect(await storageKeystore({ binary: slow, dataFolder: data, timeoutMs: 300 }).read()).toEqual({
      refused: 'locked',
    });
  });
});

describe('isFirstStart', () => {
  it('is a first start until the executor has written its keyring file', () => {
    const root = mkdtempSync(join(tmpdir(), 'we-storage-first-'));
    try {
      expect(isFirstStart(root)).toBe(true);
      mkdirSync(dirname(keyringFile(root)), { recursive: true });
      writeFileSync(keyringFile(root), '{}');
      expect(isFirstStart(root)).toBe(false);
      expect(keyringFile(root)).toBe(join(root, 'ad4m', 'keyring.json'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('storageShown', () => {
  it('keeps the state and each store, and drops what only the operator is told', () => {
    const shown = storageShown({
      state: 'open',
      encryptedAtRest: false,
      stores: { database: 'encrypted', languageStorage: 'encrypted', links: 'plain', extra: 'x' },
      keyringId: '00112233445566778899aabbccddeeff',
      secretSource: 'operator',
      secretOnDataDisk: false,
      rootGeneration: 1,
      lastError: 'something',
    });
    expect(shown).toEqual({
      state: 'open',
      encryptedAtRest: false,
      stores: { database: 'encrypted', languageStorage: 'encrypted', links: 'plain' },
    });
  });

  it('reads encrypted at rest only from a literal true', () => {
    const stores = { database: 'encrypted', languageStorage: 'encrypted', links: 'encrypted' };
    expect(storageShown({ state: 'open', encryptedAtRest: true, stores }).encryptedAtRest).toBe(true);
    expect(storageShown({ state: 'open', encryptedAtRest: 'yes', stores }).encryptedAtRest).toBe(false);
  });

  it("reads anything not in the executor's words as no status, or no stores", () => {
    expect(storageShown(null)).toBeNull();
    expect(storageShown('open')).toBeNull();
    expect(storageShown({ state: 'ajar', stores: null })).toBeNull();
    expect(storageShown({ state: 'sealed', encryptedAtRest: false, stores: null })).toEqual({
      state: 'sealed',
      encryptedAtRest: false,
      stores: null,
    });
    expect(
      storageShown({ state: 'open', encryptedAtRest: false, stores: { database: 'encrypted', links: 'plain' } }).stores,
    ).toBeNull();
    expect(
      storageShown({
        state: 'open',
        encryptedAtRest: false,
        stores: { database: 'encrypted', languageStorage: 'sealed', links: 'plain' },
      }).stores,
    ).toBeNull();
  });

  it('tells how many stores are done while the data moves under its keys, and not which', () => {
    expect(
      storageShown({
        state: 'migrating',
        encryptedAtRest: false,
        stores: null,
        keyringId: KEYRING_ID,
        migration: { step: 'language-storage', storesDone: 3, storesTotal: 5, store: 'language:QmSomeAddress' },
      }),
    ).toEqual({
      state: 'migrating',
      encryptedAtRest: false,
      stores: null,
      migration: { storesDone: 3, storesTotal: 5 },
    });
    expect(
      storageShown({ state: 'migrating', encryptedAtRest: false, stores: null, migration: null }).migration,
    ).toBeNull();
    expect(
      storageShown({
        state: 'migrating',
        encryptedAtRest: false,
        stores: null,
        migration: { storesDone: '1', storesTotal: 2 },
      }).migration,
    ).toBeNull();
  });
});

/**
 * A plaintext executor's storage, as the executor moves it under its keys at the first unlock:
 * `storage.unlock` takes any secret the first time (it makes the keyring) and the same one after,
 * then the storage is `migrating` through `total` stores, one per `advance()`, each sent as
 * `storage-migration-progress` to a socket that watched it, then `open` (`storage-state-changed`).
 * The move fails at store `failAt` on the first `failures` runs: sealed again, `migration-failed`;
 * the next unlock goes on from the stores done.
 */
function migratingExecutor({ total = 3, failAt = null, failures = 1 } = {}) {
  const gate = { state: 'sealed', done: 0, lastError: null, secret: null, runs: 0, watched: null };
  const calls = [];
  const listeners = new Set();
  const emit = (event) => {
    for (const listener of listeners) listener(event);
  };
  const migration = () =>
    gate.state === 'migrating'
      ? { step: 'database', storesDone: gate.done, storesTotal: total, store: gate.done < total ? 'executor' : null }
      : null;
  const status = () => ({
    state: gate.state,
    encryptedAtRest: gate.state === 'open',
    stores: gate.state === 'open' ? { database: 'encrypted', languageStorage: 'encrypted', links: 'encrypted' } : null,
    keyringId: KEYRING_ID,
    secretSource: gate.state === 'sealed' ? null : 'operator',
    secretOnDataDisk: false,
    rootGeneration: gate.secret ? 1 : 0,
    lastError: gate.lastError,
    migration: migration(),
  });
  const changed = () => emit({ type: 'storage-state-changed', ...status() });
  const refused = (code, message) => Object.assign(new Error(message), { refused: true, code });
  return {
    gate,
    calls,
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async call(method, params = {}) {
      calls.push({ method, params });
      if (method === 'events.watch') {
        gate.watched = params;
        return true;
      }
      if (method === 'runtime.storageStatus') return status();
      if (method === 'storage.unlock') {
        if (gate.secret && gate.secret !== params.secret)
          throw refused(403, 'the storage secret does not open this keyring');
        gate.secret = params.secret;
        gate.runs += 1;
        gate.lastError = null;
        gate.state = 'migrating';
        changed();
        return { status: status(), fingerprint: 'f', created: gate.runs === 1 };
      }
      throw refused(503, 'storage-sealed');
    },
    /** The next store moves: its progress, then the open storage after the last, or the failure. */
    advance() {
      gate.done += 1;
      if (gate.done === failAt && gate.runs <= failures) {
        gate.done -= 1;
        gate.state = 'sealed';
        gate.lastError = 'migration-failed';
        changed();
        return;
      }
      emit({ type: 'storage-migration-progress', ...migration() });
      if (gate.done === total) {
        gate.state = 'open';
        changed();
      }
    },
  };
}

/** Never resolves: nothing polls, so only the executor's events move the storage on. */
const eventsOnly = { wait: () => new Promise(() => {}), now: () => 0 };

/** A `showMigration` that hands the test the step, and ends when the test says. */
function migrationWindow() {
  let shown;
  let end;
  const step = new Promise((resolve) => (shown = resolve));
  const ended = new Promise((resolve) => (end = resolve));
  return { show: (s) => (shown(s), ended), step, end };
}

describe('the storage followed by its events', () => {
  it('watches the storage events, and takes each as the status, dropping a read an event overtook', async () => {
    const executor = migratingExecutor({ total: 2 });
    let answerRead;
    const call = async (method, params) => {
      if (method !== 'runtime.storageStatus') return executor.call(method, params);
      // A read that answers late, after an event the executor sent after it.
      const answer = await executor.call(method, params);
      await new Promise((resolve) => (answerRead = resolve));
      return answer;
    };
    const follow = followStorage({ call, onEvent: executor.onEvent, ...eventsOnly });
    await Promise.resolve();
    expect(executor.gate.watched).toEqual({ 'storage-state-changed': null, 'storage-migration-progress': null });

    const read = follow.read();
    await vi.waitFor(() => expect(answerRead).toBeTypeOf('function'));
    await executor.call('storage.unlock', { secret: SECRET_A });
    executor.advance();
    answerRead();
    // The sealed status the read carried is older than the progress the event brought.
    expect((await read).state).toBe('migrating');
    expect(follow.current().migration).toEqual({ step: 'database', storesDone: 1, storesTotal: 2, store: 'executor' });

    const heard = [];
    const unsubscribe = follow.subscribe((s) => heard.push(s.state));
    const next = follow.next();
    executor.advance();
    // The last store's progress, then the open storage: `next` is the first of them.
    expect((await next).state).toBe('migrating');
    expect(follow.current().state).toBe('open');
    expect(heard).toEqual(['migrating', 'open']);
    unsubscribe();
    follow.close();
    executor.advance();
    expect(heard).toEqual(['migrating', 'open']);
  });

  it('reads the status on the interval where the executor refuses the watch', async () => {
    const executor = fakeExecutor({ keyringSecret: SECRET_A, open: true });
    const call = async (method, params) => {
      if (method === 'events.watch') throw Object.assign(new Error('unknown'), { refused: true, code: 404 });
      return executor.call(method, params);
    };
    const follow = followStorage({ call, onEvent: () => () => {}, wait: async () => {} });
    expect((await follow.next()).state).toBe('open');
    follow.close();
  });

  it('fails the wait in words when the move under the keys fails, and gives a slow move its time again per store', async () => {
    const executor = migratingExecutor({ total: 4, failAt: 3 });
    await executor.call('storage.unlock', { secret: SECRET_A });
    let clock = 0;
    const now = () => clock;
    const follow = followStorage({ call: executor.call, onEvent: executor.onEvent, wait: eventsOnly.wait });
    const waiting = waitUntilOpen(executor.call, { follow, now, timeoutMs: 1_000 });
    for (let i = 0; i < 2; i++) {
      await vi.waitFor(() => expect(follow.current()).not.toBeNull());
      // Each store takes longer than the whole timeout; none is stuck.
      clock += 900;
      executor.advance();
      await Promise.resolve();
    }
    executor.advance();
    await expect(waiting).rejects.toThrow(storageFailure('migration-failed'));
    expect(STORAGE_WORDS['migration-failed']).toContain('Nothing was lost');
    follow.close();
  });
});

describe('moving a plaintext executor under its keys at its first unlock', () => {
  it('shows the move store by store in the identity window, then opens', async () => {
    const executor = migratingExecutor({ total: 3 });
    const keystore = fakeKeystore();
    const window = migrationWindow();
    const { log, text } = recordingLog();
    const opened = unlockStorage({
      call: executor.call,
      onEvent: executor.onEvent,
      keystore,
      firstStart: true,
      askPassphrase: () => {
        throw new Error('no passphrase is asked where the keyring keeps the secret');
      },
      showMigration: window.show,
      log,
      ...eventsOnly,
    });
    const step = await window.step;
    expect(step.first).toEqual({
      screen: { screen: 'storage-migrating', storesDone: 0, storesTotal: 3 },
      outcome: null,
    });
    for (const done of [1, 2]) {
      const next = step.submit({ kind: 'wait-storage' });
      executor.advance();
      expect(await next).toEqual({
        screen: { screen: 'storage-migrating', storesDone: done, storesTotal: 3 },
        outcome: null,
      });
    }
    const last = step.submit({ kind: 'wait-storage' });
    executor.advance();
    // The last store's progress, and the open storage sent right after it: the window is answered
    // the newest, and nothing waits for an event that already came.
    expect(await last).toEqual({ screen: { screen: 'storage-open' }, outcome: 'done' });
    window.end('done');

    const { how, status } = await opened;
    expect(how).toBe('keyring');
    expect(status.state).toBe('open');
    expect(executor.gate.runs).toBe(1);
    expect(text()).toMatch(/moving its data under its keys/);
    expect(text()).not.toContain(SECRET_A);
  });

  it('offers to try again when the move fails, and a try again unlocks once more and goes on to open', async () => {
    const executor = migratingExecutor({ total: 3, failAt: 2 });
    const keystore = fakeKeystore();
    const window = migrationWindow();
    const opened = unlockStorage({
      call: executor.call,
      onEvent: executor.onEvent,
      keystore,
      firstStart: true,
      askPassphrase: null,
      showMigration: window.show,
      log: () => {},
      ...eventsOnly,
    });
    const step = await window.step;
    let next = step.submit({ kind: 'wait-storage' });
    executor.advance();
    expect((await next).screen).toEqual({ screen: 'storage-migrating', storesDone: 1, storesTotal: 3 });
    next = step.submit({ kind: 'wait-storage' });
    executor.advance();
    expect(await next).toEqual({ screen: { screen: 'storage-migration-failed' }, outcome: null });

    // Try again: the secret is read from the keyring (never made again) and handed over once more.
    const again = await step.submit({ kind: 'try-again' });
    expect(again).toEqual({ screen: { screen: 'storage-migrating', storesDone: 1, storesTotal: 3 }, outcome: null });
    expect([keystore.makes, keystore.reads]).toEqual([1, 1]);
    expect(executor.calls.filter((c) => c.method === 'storage.unlock')).toHaveLength(2);
    expect(keystore.given.every((secret) => secret.every((byte) => byte === 0))).toBe(true);
    for (const expected of [
      { screen: 'storage-migrating', storesDone: 2, storesTotal: 3 },
      { screen: 'storage-open' },
    ]) {
      next = step.submit({ kind: 'wait-storage' });
      executor.advance();
      expect((await next).screen).toEqual(expected);
    }
    window.end('done');
    expect((await opened).how).toBe('keyring');
  });

  it('fails the start in plain words when the window is closed on a failed move', async () => {
    const executor = migratingExecutor({ total: 2, failAt: 1 });
    const window = migrationWindow();
    const opened = unlockStorage({
      call: executor.call,
      onEvent: executor.onEvent,
      keystore: fakeKeystore(),
      firstStart: true,
      askPassphrase: null,
      showMigration: window.show,
      log: () => {},
      ...eventsOnly,
    });
    const step = await window.step;
    const next = step.submit({ kind: 'wait-storage' });
    executor.advance();
    expect((await next).screen).toEqual({ screen: 'storage-migration-failed' });
    window.end('cancelled');
    await expect(opened).rejects.toThrow(`${STORAGE_LOCKED} ${STORAGE_WORDS['migration-failed']}`);
  });

  it('keeps waiting on the move when its window is closed while it runs', async () => {
    const executor = migratingExecutor({ total: 2 });
    const window = migrationWindow();
    const opened = unlockStorage({
      call: executor.call,
      onEvent: executor.onEvent,
      keystore: fakeKeystore(),
      firstStart: true,
      askPassphrase: null,
      showMigration: window.show,
      log: () => {},
      ...eventsOnly,
    });
    await window.step;
    window.end('cancelled');
    // The start reads the status again, and is still waiting on the move.
    await vi.waitFor(() =>
      expect(executor.calls.filter((c) => c.method === 'runtime.storageStatus').length).toBeGreaterThanOrEqual(3),
    );
    executor.advance();
    executor.advance();
    expect((await opened).status.state).toBe('open');
  });

  it('without a window, fails the start in words when the move fails', async () => {
    const executor = migratingExecutor({ total: 2, failAt: 1 });
    const opened = unlockStorage({
      call: executor.call,
      onEvent: executor.onEvent,
      keystore: fakeKeystore(),
      firstStart: true,
      askPassphrase: null,
      log: () => {},
      ...eventsOnly,
    });
    await vi.waitFor(() => expect(executor.gate.state).toBe('migrating'));
    await vi.waitFor(() =>
      expect(executor.calls.filter((c) => c.method === 'runtime.storageStatus').length).toBeGreaterThanOrEqual(2),
    );
    executor.advance();
    await expect(opened).rejects.toThrow(storageFailure('migration-failed'));
  });

  it('shows the move after the storage passphrase too, and asks for it again when the move fails', async () => {
    const executor = migratingExecutor({ total: 2, failAt: 2 });
    const keystore = fakeKeystore({ kind: 'absent' });
    const passphrase = 'correct horse battery staple';
    let ended;
    const opened = unlockStorage({
      call: executor.call,
      onEvent: executor.onEvent,
      keystore,
      firstStart: true,
      askPassphrase: async (step) => {
        expect(step.first.screen).toEqual({ screen: 'set-storage-passphrase', error: null });
        let answer = await step.submit({ kind: 'passphrase', passphrase, confirm: passphrase });
        expect(answer).toEqual({
          screen: { screen: 'storage-migrating', storesDone: 0, storesTotal: 2 },
          outcome: null,
        });
        let next = step.submit({ kind: 'wait-storage' });
        executor.advance();
        expect((await next).screen).toEqual({ screen: 'storage-migrating', storesDone: 1, storesTotal: 2 });
        next = step.submit({ kind: 'wait-storage' });
        executor.advance();
        // Failed: the passphrase starts it again, as at every later start (the keyring is made).
        expect(await next).toEqual({
          screen: { screen: 'unlock-storage', error: MIGRATION_FAILED_PASSPHRASE },
          outcome: null,
        });
        answer = await step.submit({ kind: 'passphrase', passphrase });
        expect(answer.screen).toEqual({ screen: 'storage-migrating', storesDone: 1, storesTotal: 2 });
        next = step.submit({ kind: 'wait-storage' });
        executor.advance();
        ended = await next;
        return ended.outcome;
      },
      log: () => {},
      ...eventsOnly,
    });
    expect((await opened).how).toBe('passphrase');
    expect(ended).toEqual({ screen: { screen: 'storage-open' }, outcome: 'done' });
    expect(keystore.derives.map((d) => d.isNew)).toEqual([true, false]);
    expect(executor.calls.filter((c) => c.method === 'storage.unlock')).toHaveLength(2);
  });
});
