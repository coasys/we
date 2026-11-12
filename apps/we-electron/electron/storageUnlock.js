/**
 * The executor's storage, unlocked by the supervisor before anything else of a start.
 *
 * The executor keeps its data encrypted on disk and starts sealed: until it is handed its storage
 * secret it answers `runtime.storageStatus` and `storage.unlock` and nothing else (every other call
 * is 503 `storage-sealed`; `/health` answers ok all the same). So after the executor is up, and
 * before the main agent and custody, the supervisor:
 *
 * 1. reads `runtime.storageStatus`; an executor already `open` needs nothing;
 * 2. reads the storage secret this computer's keyring keeps for the data folder
 *    (`we-custody storage-secret read|make`, `crates/custody/src/storage_secret.rs`) — made, 32 random
 *    bytes as 64 hex, only where the folder has no keyring file yet, so a folder whose data is under
 *    a secret is never given a new one;
 * 3. hands it to the executor with `storage.unlock`, as the operator (the admin credential), over the
 *    loopback WebSocket, and zeroes its own copy whatever the answer;
 * 4. waits for its storage to be `open`, following `storage-state-changed` (and reading
 *    `runtime.storageStatus` besides, for an executor that sends no events).
 *
 * An executor that ran before its data was encrypted keeps it in plaintext until its first unlock,
 * which moves it under its keys: the storage is `migrating` meanwhile, and `storage-migration-progress`
 * says how many stores are done. The identity window shows "Moving your data under its key: X of Y"
 * until it is open. A move that fails leaves the plaintext as it was and the storage sealed again
 * (`lastError: migration-failed`); the window offers to try again, which is a new `storage.unlock`.
 *
 * Where there is no keyring at all (a Linux desktop with no Secret Service: custody answers
 * `unavailable`), nothing can keep the secret, so the person gives a storage passphrase in the
 * identity window — chosen on the folder's first start, typed at each start after — and custody
 * derives the secret from it (Argon2id, salted with the executor's keyring id). A wrong one is asked
 * again, with no limit. A folder that has keys and nothing kept for it in a keyring that is there
 * was first opened where there was none, so it too is asked its passphrase. Closing the window leaves the data shut and the start failed, with "Try again".
 *
 * Nothing here logs a secret, a passphrase or a path: this process's console is copied into the
 * executor log. The secret is read into a Buffer and zeroed; the string the call is sent as cannot
 * be (JavaScript strings are immutable), so this is defence in depth, not zeroisation end to end.
 */
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

import { withoutCustodyCredential } from './executorProcess.js';

/** What every failure to open the data says first. */
export const STORAGE_LOCKED = "Coasys can't open your data on this computer.";

/** What the passphrase step says to a passphrase that does not open the data. */
export const WRONG_STORAGE_PASSPHRASE = "That passphrase does not open this computer's data.";

/** Why, after {@link STORAGE_LOCKED}: no path, no secret. */
export const STORAGE_WORDS = Object.freeze({
  locked:
    "This computer's keyring is locked, and it keeps the key to your data. Unlock the keyring (your login password usually does), then try again.",
  failed:
    "The key to your data is kept in this computer's keyring, and the keyring did not answer. Try again; if it keeps happening, restart the keyring (on Linux, a Secret Service such as GNOME Keyring or KWallet), or the computer.",
  wrong: "The key this computer's keyring keeps does not open your data.",
  corrupt: 'The file that holds the keys to your data is damaged.',
  'on-data-disk': 'The executor was given its key from a file on the same disk as the data, which it refuses.',
  'no-helper':
    'The part of the app that keeps the key to your data is missing. Reinstall the app; in development, build it with `cargo build --release` in crates/custody.',
  cancelled: 'The passphrase that opens it was not given.',
  timeout: 'Your data did not finish opening.',
  'migration-failed':
    'Moving your data under its key did not finish. Nothing was lost: your data stays as it was until the move finishes. Try again.',
});

/** What the passphrase step says when the move under its key failed: the passphrase starts it again. */
export const MIGRATION_FAILED_PASSPHRASE =
  'Moving your data under its key did not finish. Nothing was lost: your data stays as it was. Type the passphrase to try again.';

/** The executor's events the supervisor follows its storage by (`events.watch`). */
export const STORAGE_EVENTS = Object.freeze(['storage-state-changed', 'storage-migration-progress']);

/** The words a start that could not open the data fails with. */
export function storageFailure(why) {
  return `${STORAGE_LOCKED} ${STORAGE_WORDS[why] ?? why}`;
}

/** An error for the window, marked so the start does not wrap it again. */
function failure(why) {
  return Object.assign(new Error(storageFailure(why)), { storage: why });
}

/** The executor's keyring file for `dataFolder`: present once any secret has opened the folder. */
export function keyringFile(dataFolder) {
  return join(dataFolder, 'ad4m', 'keyring.json');
}

/** How long the helper may take: its own wait on a locked keyring is bounded at 90 s. */
const HELPER_TIMEOUT_MS = 100_000;

const SECRET_PREFIX = Buffer.from('{"secret":"');
const SECRET_SUFFIX = Buffer.from('"}');
const SECRET_HEX = 64;

/**
 * The secret in a helper's line, as a Buffer of its 64 hex characters, or null where the line is
 * not `{"secret": …}`. Read from the bytes, never through a string.
 */
export function secretFromLine(bytes) {
  const end = SECRET_PREFIX.length + SECRET_HEX;
  if (bytes.length < end + SECRET_SUFFIX.length) return null;
  if (!bytes.subarray(0, SECRET_PREFIX.length).equals(SECRET_PREFIX)) return null;
  if (!bytes.subarray(end, end + SECRET_SUFFIX.length).equals(SECRET_SUFFIX)) return null;
  const secret = Buffer.alloc(SECRET_HEX);
  bytes.copy(secret, 0, SECRET_PREFIX.length, end);
  for (const byte of secret) {
    const hex = (byte >= 0x30 && byte <= 0x39) || (byte >= 0x61 && byte <= 0x66) || (byte >= 0x41 && byte <= 0x46);
    if (!hex) {
      secret.fill(0);
      return null;
    }
  }
  return secret;
}

/**
 * Runs the helper with `args` (and `input` on stdin), and answers its one line: `{secret: Buffer}`,
 * `{none: true}`, or `{refused, reason?}`. What it printed is zeroed once read. A helper that fails,
 * does not start or answers nothing readable is `failed`; one that takes past `timeoutMs` is stopped
 * and is `locked` (a keyring prompt nobody answered).
 */
function runHelper({ binary, args, env, input = null, timeoutMs }) {
  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;
    const done = (answer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(answer);
    };
    const child = spawn(binary, args, { env, stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      done({ refused: 'locked' });
    }, timeoutMs);
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    // Its stderr holds no secret: a reason, at most.
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.on('error', (err) => done({ refused: 'failed', reason: `the keyring helper did not start: ${err.code}` }));
    if (input !== null) {
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
    child.on('close', (code) => {
      const out = Buffer.concat(chunks);
      for (const chunk of chunks) chunk.fill(0);
      const newline = out.indexOf(0x0a);
      const line = newline === -1 ? out : out.subarray(0, newline);
      let answer = null;
      const secret = code === 0 ? secretFromLine(line) : null;
      if (secret) answer = { secret };
      else {
        try {
          // Not a secret line, so no secret in it.
          answer = JSON.parse(line.toString('utf8'));
        } catch {
          // Not an answer: below.
        }
      }
      out.fill(0);
      if (code === 0 && answer && typeof answer === 'object' && !('secret' in answer && !secret)) done(answer);
      else done({ refused: 'failed', reason: `the keyring helper exited ${code}` });
    });
  });
}

/**
 * The storage secret's keyring item for `dataFolder`, through `we-custody storage-secret`:
 * `read()`, `make()`, and `derive({keyringId, passphrase, confirm, isNew})` for a storage passphrase.
 * No credential reaches the helper.
 */
export function storageKeystore({ binary, dataFolder, baseEnv = process.env, timeoutMs = HELPER_TIMEOUT_MS }) {
  const env = withoutCustodyCredential(baseEnv);
  delete env.AD4M_ADMIN_CREDENTIAL;
  const keyring = (mode) =>
    runHelper({ binary, args: ['storage-secret', mode, '--data-folder', dataFolder], env, timeoutMs });
  return {
    read: () => keyring('read'),
    make: () => keyring('make'),
    derive: ({ keyringId, passphrase, confirm, isNew }) =>
      runHelper({
        binary,
        args: ['storage-secret', 'derive', '--keyring-id', keyringId, ...(isNew ? ['--new'] : [])],
        env,
        input: `${JSON.stringify(isNew ? { passphrase, confirm: confirm ?? '' } : { passphrase })}\n`,
        timeoutMs,
      }),
  };
}

/**
 * Hands `secret` (a Buffer of 64 hex characters) to the executor, and zeroes it whatever the answer.
 * Answers `'unlocked'` or `'wrong'` (403: not the secret this data is under); throws the start's
 * words for anything else. The executor's message is not logged: only its code.
 */
async function giveSecret(call, secret, log) {
  try {
    await call('storage.unlock', { secret: secret.toString('latin1') });
    return 'unlocked';
  } catch (err) {
    if (err?.refused && err.code === 403) return 'wrong';
    log('[main] storage.unlock was refused:', err?.refused ? err.code : 'no answer');
    if (err?.refused && err.code === 400) throw failure('on-data-disk');
    if (err?.refused && err.code === 500) throw failure('corrupt');
    throw failure('failed');
  } finally {
    secret.fill(0);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Follows the executor's storage on one admin socket: the status as last heard, from
 * `storage-state-changed` and `storage-migration-progress` where `onEvent` is given (`executorRpc`'s,
 * after `events.watch` for both, which the executor answers while sealed), and from reading
 * `runtime.storageStatus` every `interval` ms in addition, for an executor that sends no events. An
 * event is newer than a read that was on its way when it came, so that read is dropped.
 *
 * `read()` answers the status now; `next()` the next one heard, by an event or the next read;
 * `subscribe(listener)` hears each one and answers its unsubscribe; `close()` stops listening.
 */
export function followStorage({ call, onEvent = null, interval, wait = sleep }) {
  let status = null;
  let heard = 0;
  let waiters = [];
  let watching = false;
  const listeners = new Set();
  const set = (next) => {
    heard += 1;
    status = next;
    const woken = waiters;
    waiters = [];
    for (const wake of woken) wake(next);
    for (const listener of listeners) listener(next);
  };
  const off = onEvent
    ? onEvent((event) => {
        const { type, ...payload } = event ?? {};
        if (type === 'storage-state-changed') set(payload);
        // Progress after the store opened is late: the open status already says it is done.
        else if (type === 'storage-migration-progress' && status?.state !== 'open')
          set({ ...(status ?? {}), state: 'migrating', migration: payload });
      })
    : null;
  if (onEvent) {
    const wanted = Object.fromEntries(STORAGE_EVENTS.map((name) => [name, null]));
    // An executor that refuses the watch is read on the interval alone.
    Promise.resolve(call('events.watch', wanted)).then(
      () => (watching = true),
      () => {},
    );
  }
  const read = async () => {
    const at = heard;
    const answer = await call('runtime.storageStatus');
    if (heard === at) set(answer);
    return status;
  };
  return {
    current: () => status,
    heard: () => heard,
    read,
    next(after) {
      return new Promise((resolve, reject) => {
        // Something was heard since the caller's `heard()`: that is its next status.
        if (after !== undefined && heard > after) {
          resolve(status);
          return;
        }
        let done = false;
        const finish = (next) => {
          if (done) return;
          done = true;
          resolve(next);
        };
        waiters.push(finish);
        const every = interval ?? (watching ? 1_000 : 100);
        wait(every).then(() => {
          if (done) return;
          read().then(finish, (err) => {
            if (done) return;
            done = true;
            reject(err);
          });
        });
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      off?.();
      listeners.clear();
    },
  };
}

/** The words for a sealed status that says why the last unlock failed, else null. */
function sealedFailure(status) {
  if (status?.state !== 'sealed') return null;
  if (status.lastError === 'corrupt-keyring') return 'corrupt';
  if (status.lastError === 'migration-failed') return 'migration-failed';
  return null;
}

/** How far a move under the keys is, as a key that changes with each store it finishes. */
const progressKey = (status) =>
  status?.state === 'migrating'
    ? `${status.migration?.step ?? ''}:${status.migration?.storesDone ?? ''}/${status.migration?.storesTotal ?? ''}`
    : null;

/**
 * Follows `follow` until `stop(status)`, from a fresh read (or, with `first: 'next'`, from the next
 * status heard). Throws the start's words for a sealed status that says why, and past `timeoutMs` —
 * which a move under the keys is given again each time it finishes a store: it is slow, not stuck.
 */
async function watchUntil(follow, stop, { timeoutMs = 60_000, now = Date.now, first = 'read' } = {}) {
  let deadline = now() + timeoutMs;
  let moved = null;
  let status = first === 'next' ? await follow.next() : first === 'current' ? follow.current() : await follow.read();
  // Events can come between two waits; each wait starts from the last one taken, so none is missed.
  let seen = follow.heard();
  status = follow.current() ?? status;
  for (;;) {
    if (stop(status)) return status;
    const why = sealedFailure(status);
    if (why) throw failure(why);
    const progress = progressKey(status);
    if (progress !== null && progress !== moved) {
      moved = progress;
      deadline = now() + timeoutMs;
    }
    if (now() >= deadline) throw failure('timeout');
    const next = await follow.next(seen);
    seen = follow.heard();
    status = follow.current() ?? next;
  }
}

/**
 * Waits until `runtime.storageStatus` is `open`, following `follow` ({@link followStorage}) or, without
 * one, reading the status every `interval` ms; throws the start's words for a keyring that is damaged,
 * a move under the keys that failed, or past `timeoutMs`.
 */
export async function waitUntilOpen(call, { follow, timeoutMs = 60_000, interval, wait = sleep, now = Date.now } = {}) {
  const following = follow ?? followStorage({ call, interval: interval ?? 100, wait });
  return watchUntil(following, (status) => status?.state === 'open', { timeoutMs, now });
}

/** The window's screen for a status that is moving the data under its keys: how far it is. */
export function migrationScreen(status) {
  const m = status?.migration;
  const count = (n) => (Number.isInteger(n) && n >= 0 ? n : 0);
  return { screen: 'storage-migrating', storesDone: count(m?.storesDone), storesTotal: count(m?.storesTotal) };
}

/**
 * The window's next screen once a secret was taken, as `{screen, outcome}`: `storage-open` (done), or
 * the move's progress while the data moves under its keys. With `first: 'next'` it waits for the
 * status past the progress the window shows (`shown`). A move that failed answers `onFailed()`; any
 * other failure is the `failed` screen.
 */
async function settledScreen(follow, { onFailed, shown = null, first = 'read', now, timeoutMs }) {
  let status;
  // A status heard since the window was last answered (the store opened right after the last
  // progress, say) is the next one: waiting for another would wait for nothing.
  const heard = follow.current();
  const unseen = heard && !(heard.state === 'migrating' && progressKey(heard) === shown);
  const from = first === 'next' && unseen ? 'current' : first;
  try {
    status = await watchUntil(
      follow,
      (s) => s?.state === 'open' || (s?.state === 'migrating' && progressKey(s) !== shown),
      { first: from, now, timeoutMs },
    );
  } catch (err) {
    if (err?.storage === 'migration-failed') return onFailed();
    return {
      screen: { screen: 'failed', message: err?.storage ? err.message : storageFailure('failed') },
      outcome: 'failed',
    };
  }
  if (status.state === 'open') return { screen: { screen: 'storage-open' }, outcome: 'done' };
  return { screen: migrationScreen(status), outcome: null, progress: progressKey(status) };
}

/**
 * The window's step while the executor moves a plaintext data folder under its keys, after the secret
 * the keyring keeps opened it: `first` is the progress, and the window asks for the next one with
 * `{kind: 'wait-storage'}` until the data is open (`storage-open`, done). A move that failed shows
 * `storage-migration-failed`, and `{kind: 'try-again'}` hands the executor the secret again
 * (`retry()`, a new `storage.unlock`), which runs the steps not done.
 */
export function migrationStep({ follow, retry, status, now, timeoutMs }) {
  const failedMove = () => ({ screen: { screen: 'storage-migration-failed' }, outcome: null });
  let shown = progressKey(status);
  const showing = (answer) => {
    if (answer.progress !== undefined) shown = answer.progress;
    return { screen: answer.screen, outcome: answer.outcome };
  };
  return {
    first: { screen: migrationScreen(status), outcome: null },
    async submit(input) {
      if (input?.kind === 'try-again') {
        const again = await retry();
        if (again) return again;
        shown = null;
        return showing(await settledScreen(follow, { onFailed: failedMove, now, timeoutMs }));
      }
      if (input?.kind !== 'wait-storage') return { screen: migrationScreen(follow.current()), outcome: null };
      return showing(await settledScreen(follow, { onFailed: failedMove, shown, first: 'next', now, timeoutMs }));
    },
  };
}

/**
 * The passphrase step's driver, for the identity window (`identityWindow.js`'s `openStorage`): the
 * answer it starts on, and `submit(input)` answering the next, each `{screen, outcome}` as custody's
 * are — the same screen with an error, or `storage-open` with `outcome: 'done'` once the data is open,
 * which ends the step. A failure that asking again cannot mend is `failed`, `outcome: 'failed'`.
 *
 * Where the executor moves plaintext data under its keys after the passphrase opened it, the window
 * shows how far it is (`storage-migrating`) and asks for the next with `{kind: 'wait-storage'}`; a
 * move that failed asks for the passphrase again ({@link MIGRATION_FAILED_PASSPHRASE}), which starts
 * it again. `follow` is {@link followStorage}; without one the status is read every 100 ms.
 */
export function passphraseStep({ call, keystore, keyringId, first, follow, log = console.log, now, timeoutMs }) {
  const following = follow ?? followStorage({ call });
  // A move that failed leaves the keyring made: the passphrase is asked as at every later start.
  let isNew = first;
  let name = first ? 'set-storage-passphrase' : 'unlock-storage';
  let shown = null;
  const again = (error) => ({ screen: { screen: name, error }, outcome: null });
  const failed = (message) => ({ screen: { screen: 'failed', message }, outcome: 'failed' });
  const moveFailed = () => {
    log('[main] Moving the data under its keys failed: the storage passphrase starts it again');
    isNew = false;
    name = 'unlock-storage';
    return again(MIGRATION_FAILED_PASSPHRASE);
  };
  const showing = (answer) => {
    if (answer.progress !== undefined) shown = answer.progress;
    return { screen: answer.screen, outcome: answer.outcome };
  };
  return {
    first: again(null),
    async submit(input) {
      if (input?.kind === 'wait-storage')
        return showing(await settledScreen(following, { onFailed: moveFailed, shown, first: 'next', now, timeoutMs }));
      if (input?.kind !== 'passphrase' || typeof input.passphrase !== 'string' || !input.passphrase)
        return again('Type the passphrase.');
      const derived = await keystore.derive({
        keyringId,
        passphrase: input.passphrase,
        confirm: typeof input.confirm === 'string' ? input.confirm : '',
        isNew,
      });
      if (derived?.refused === 'passphrase') return again(String(derived.reason ?? 'Type the passphrase.'));
      if (!derived?.secret) {
        log('[main] The storage passphrase could not be derived:', derived?.refused ?? 'no answer');
        return failed(storageFailure('failed'));
      }
      let given;
      try {
        given = await giveSecret(call, derived.secret, log);
      } catch (err) {
        return failed(err.message);
      }
      if (given === 'wrong') return again(WRONG_STORAGE_PASSPHRASE);
      shown = null;
      return showing(await settledScreen(following, { onFailed: moveFailed, now, timeoutMs }));
    },
  };
}

/**
 * Opens the executor's storage, or throws in words for the window (`storageFailure`). `call` is an
 * admin call to the executor (`executorRpc`), and `onEvent` its event listener, by which the storage
 * is followed ({@link followStorage}; without it the status is read every 100 ms); `keystore` is
 * {@link storageKeystore}, or null where there is no custody helper (an executor that is already open
 * needs none); `firstStart` says the folder has no keyring file yet ({@link keyringFile});
 * `askPassphrase(step)` opens the identity window on {@link passphraseStep}'s `step` and resolves
 * `'done'` or `'cancelled'`; `showMigration(step)`, where given, opens it on {@link migrationStep}'s
 * while a plaintext folder moves under its keys after the keyring's secret opened it, and resolves the
 * same. Closing either window while the data moves leaves the move running and the start waiting on
 * it; closing it on a failed move fails the start. Resolves the status once `open`, and how it was
 * opened: `'already'`, `'keyring'` or `'passphrase'`.
 */
export async function unlockStorage({
  call,
  onEvent = null,
  keystore,
  firstStart,
  askPassphrase,
  showMigration = null,
  log = console.log,
  wait,
  now,
  timeoutMs,
}) {
  const follow = followStorage({ call, onEvent, wait });
  try {
    const status = await follow.read();
    if (status?.state === 'open') return { status, how: 'already' };
    const until = (how) => waitUntilOpen(call, { follow, now, timeoutMs }).then((open) => ({ status: open, how }));
    if (status?.state === 'unlocking' || status?.state === 'migrating') return await until('already');
    // Nothing to keep a secret in, and nothing to derive one with.
    if (!keystore) throw failure('no-helper');

    const answer = firstStart ? await keystore.make() : await keystore.read();
    if (answer?.secret) {
      const given = await giveSecret(call, answer.secret, log);
      if (given === 'wrong') {
        log('[main] The storage secret the keyring keeps did not open the data');
        throw failure('wrong');
      }
      log('[main] Storage unlocked with the secret the keyring keeps');
      if (showMigration) {
        const settled = await watchUntil(follow, (s) => s?.state === 'open' || s?.state === 'migrating', {
          now,
          timeoutMs,
        });
        if (settled.state === 'migrating') {
          log('[main] The executor is moving its data under its keys');
          const retry = async () => {
            // The keyring was made by the unlock that started the move: read, never made again.
            const kept = await keystore.read();
            if (!kept?.secret) {
              log('[main] The keyring refused the storage secret on a retry:', kept?.refused ?? 'no answer');
              return {
                screen: { screen: 'failed', message: storageFailure(kept?.refused === 'locked' ? 'locked' : 'failed') },
                outcome: 'failed',
              };
            }
            let given;
            try {
              given = await giveSecret(call, kept.secret, log);
            } catch (err) {
              return { screen: { screen: 'failed', message: err.message }, outcome: 'failed' };
            }
            if (given === 'wrong')
              return { screen: { screen: 'failed', message: storageFailure('wrong') }, outcome: 'failed' };
            log('[main] Storage given its secret again to finish moving the data');
            return null;
          };
          const ended = await showMigration(migrationStep({ follow, retry, status: settled, now, timeoutMs }));
          if (ended === 'done' && follow.current()?.state === 'open')
            return { status: follow.current(), how: 'keyring' };
          // Closed on a move that failed, or on a retry the keyring refused: the data stays shut.
          const after = await follow.read();
          if (after?.state === 'sealed') throw failure(sealedFailure(after) ?? 'migration-failed');
        }
      }
      return await until('keyring');
    }
    // No keyring at all, or one that keeps nothing for a folder that has keys: a folder first opened
    // where there was no keyring is under a passphrase, and stays so after a keyring appears.
    if (answer?.refused === 'unavailable' || answer?.none === true) {
      log(
        answer.none
          ? '[main] The keyring keeps no storage secret for this folder: the storage passphrase opens the data'
          : '[main] No keyring on this computer: the storage passphrase opens the data',
      );
      const step = passphraseStep({
        call,
        keystore,
        keyringId: status.keyringId,
        first: firstStart,
        follow,
        log,
        now,
        timeoutMs,
      });
      const ended = await askPassphrase(step);
      // A window closed while the data moves leaves the move running: the start waits on it.
      const on = follow.current()?.state;
      if (ended !== 'done' && on !== 'migrating' && on !== 'unlocking' && on !== 'open') throw failure('cancelled');
      log('[main] Storage unlocked with the storage passphrase');
      return await until('passphrase');
    }
    log('[main] The keyring refused the storage secret:', answer?.refused ?? 'no answer');
    throw failure(answer?.refused === 'locked' ? 'locked' : 'failed');
  } finally {
    follow.close();
  }
}

const STATES = new Set(['sealed', 'unlocking', 'migrating', 'open']);
const AT_REST = new Set(['plain', 'migrating', 'encrypted']);

/**
 * What the window is told of the executor's `runtime.storageStatus` (or `storage-state-changed`): its
 * state, whether it is encrypted at rest, each store's state, and while the data moves under its keys,
 * how many of its stores are done. Nothing of the keyring, where the secret came from, the last error,
 * or which store is moving. A value the executor did not answer in its own words reads as no status
 * (null); a store map with any store missing or unknown reads as no stores.
 */
export function storageShown(status) {
  if (!status || typeof status !== 'object' || !STATES.has(status.state)) return null;
  const s = status.stores;
  const stores =
    s && AT_REST.has(s.database) && AT_REST.has(s.languageStorage) && AT_REST.has(s.links)
      ? { database: s.database, languageStorage: s.languageStorage, links: s.links }
      : null;
  const shown = { state: status.state, encryptedAtRest: status.encryptedAtRest === true, stores };
  if (status.state !== 'migrating') return shown;
  const m = status.migration;
  const counted = (n) => Number.isInteger(n) && n >= 0;
  const migration =
    m && counted(m.storesDone) && counted(m.storesTotal)
      ? { storesDone: m.storesDone, storesTotal: m.storesTotal }
      : null;
  return { ...shown, migration };
}

/** Whether the folder has keys yet: no keyring file means this is its first start. */
export function isFirstStart(dataFolder) {
  return !existsSync(keyringFile(dataFolder));
}
