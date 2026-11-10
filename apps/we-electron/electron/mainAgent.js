/**
 * The executor's main agent, made and unlocked by the supervisor, with no password asked for.
 *
 * ## A stopgap ahead of AR-06
 *
 * The app before a session opens the identity window, whose steps run in custody against the
 * executor's main agent. WE used to make that agent only at "Create account", after the hand-off,
 * and to unlock it only at sign-in, so on a new computer every identity door failed ("DID requested
 * but not yet set in AgentService"), and after a restart they failed until sign-in ("main key not
 * found"). So the supervisor makes it on the first start, with a random passphrase this computer's
 * keyring keeps (`we-custody wallet-passphrase`, `crates/custody/src/wallet.rs`), and unlocks it
 * with that passphrase on every start after. Slice 3's AR-06 replaces all of this: the executor's
 * storage is unlocked by a secret of its own (`storage.unlock`), and this file and the keyring item
 * go.
 *
 * What it leaves alone: an agent already unlocked; an agent whose passphrase the keyring does not
 * hold — one made before this, with a WE password, or one whose kept item was lost, which cannot be
 * told apart (it stays locked, and WE's sign-in unlocks the first as it did); an agent the kept
 * passphrase does not unlock (the same); and an agent made while the keyring was asked, which is read
 * again before `agent.generate` because that makes over one already made.
 *
 * ## A desktop with no keyring it can use
 *
 * No Secret Service, or a keyring still locked past custody's 90 s: the WE password stands in for the
 * kept passphrase. The start answers `needs-new-password` where there is no agent yet, and
 * `needs-password` for an agent with nothing kept for it; the base app asks for the password, and
 * {@link giveAgentPassword} makes the agent with it or unlocks it. Only an agent whose passphrase *is*
 * kept fails the start, in {@link KEYRING_WORDS}: its passphrase is random, the person never knew it,
 * and nothing but the keyring opens it. Which agent that is cannot be read from a keyring that does not
 * answer, so the supervisor notes it beside the data folder ({@link keptMarker}) once the agent is made
 * or unlocked with a kept passphrase.
 *
 * Neither the passphrase nor the password is ever logged: this process's console is copied into the
 * executor log (`main.js`), and the words the window is given carry neither it nor a path.
 */
import { spawn } from 'child_process';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

import { withoutCustodyCredential } from './executorProcess.js';

/**
 * Why a start failed for the keyring, in words for the window: no path, no secret. Said only of an agent
 * whose passphrase the keyring keeps, which nothing else opens.
 */
export const KEYRING_WORDS = Object.freeze({
  locked:
    "This computer's keyring is locked, and it keeps the key to your agent, so the app cannot unlock it. Unlock the keyring (your login password usually does), then try again.",
  unavailable:
    "The key to your agent is kept in this computer's keyring, and the app cannot reach the keyring (on Linux, a Secret Service such as GNOME Keyring or KWallet). Start it, then try again.",
});

/** The marker's file, in the executor's data folder. It holds no secret: it says only that one is kept. */
const KEPT_MARKER = 'we-agent-passphrase-kept';

/**
 * The note that the agent in `dataFolder` was made or unlocked with a passphrase this computer's
 * keyring keeps, for when the keyring does not answer: `has()`, `note()`, `forget()`. Never throws: a
 * note that cannot be written is logged, and that agent is then asked a password for, as a WE
 * password's would be, should the keyring later refuse.
 */
export function keptMarker(dataFolder) {
  const file = join(dataFolder, KEPT_MARKER);
  const quietly = (what, act) => {
    try {
      act();
    } catch (err) {
      console.error(`[main] Could not ${what} the note of a kept passphrase:`, err?.code ?? err?.message);
    }
  };
  return {
    has: () => existsSync(file),
    note: () => quietly('write', () => existsSync(file) || writeFileSync(file, 'kept in this computer’s keyring\n')),
    forget: () => quietly('remove', () => existsSync(file) && unlinkSync(file)),
  };
}

/** For callers that keep no note: every agent is one with nothing kept. */
const NO_MARKER = Object.freeze({ has: () => false, note: () => {}, forget: () => {} });

/**
 * Makes sure the executor's main agent exists and is unlocked. `call(method, params)` is an admin
 * call to the executor ({@link executorRpc}); `keyring` answers `read()` and `make()`
 * ({@link walletKeyring}); `marker` notes which agent's passphrase is kept ({@link keptMarker}).
 * Resolves `'unlocked'`; `'locked'` for an agent left to WE's sign-in; or, where the keyring refuses,
 * `'needs-new-password'` (no agent yet) or `'needs-password'` (one with nothing kept for it), for the
 * WE password ({@link giveAgentPassword}). Rejects when the keyring refuses for an agent whose
 * passphrase it keeps, or when the executor fails to make the agent.
 */
export async function ensureMainAgent({ call, keyring, marker = NO_MARKER, log = console.log }) {
  const status = await call('agent.status');
  if (status?.isUnlocked) return 'unlocked';

  if (!status?.isInitialized) {
    // `wallet-passphrase make` is read-then-write on the keyring item (it keeps the item there is, or
    // makes one), with no lock of its own: two supervisors on one data folder could each make one.
    // Electron's single-instance lock (`main.js`) is what keeps there from being two.
    const answer = await keyring.make();
    if (refusal(answer)) {
      log('[main] No keyring can keep the main agent’s passphrase: the WE password is asked for instead');
      return 'needs-new-password';
    }
    const passphrase = kept(answer);
    if (passphrase === null) throw new Error(KEYRING_WORDS.unavailable);
    // The keyring may have waited on a prompt, and the agent been made meanwhile (WE's own "Create
    // account"). `agent.generate` makes over one that is made, keys and all: read it again first.
    const now = await call('agent.status');
    if (now?.isUnlocked) return 'unlocked';
    if (now?.isInitialized) {
      log('[main] The main agent was made while the keyring was asked: unlocking it, not making it');
      return unlockWith(call, passphrase, marker, log);
    }
    log('[main] Making the main agent: its passphrase is kept in this computer’s keyring');
    const made = await call('agent.generate', { passphrase });
    marker.note();
    // Languages that did not load are the executor's to report; the agent is made either way.
    if (made?.error) log('[main] The main agent was made, with an error:', made.error);
    return 'unlocked';
  }

  const answer = await keyring.read();
  if (refusal(answer)) {
    // Kept there, nothing else opens it: the start fails, and "Try again" asks the keyring again.
    if (marker.has()) throw new Error(KEYRING_WORDS[answer.refused] ?? KEYRING_WORDS.unavailable);
    log(
      '[main] The keyring cannot be read, and the main agent’s passphrase is not kept there: the WE password is asked for',
    );
    return 'needs-password';
  }
  const passphrase = kept(answer);
  if (passphrase === null) {
    // A WE password's agent, or one whose kept item was lost: from here the two look the same.
    log('[main] No passphrase is kept for the main agent: it stays locked until sign-in');
    return 'locked';
  }
  return unlockWith(call, passphrase, marker, log);
}

/**
 * The WE password, given where the start answered `need` — `'needs-new-password'` or
 * `'needs-password'` — because the keyring could not be used. Makes the agent with it (`agent.generate`)
 * where there is none, or unlocks the agent with it. Resolves `'unlocked'`, or `'wrong'` where the
 * executor refused the password (the agent stays locked); rejects where the executor could not be
 * asked, or refused to make the agent. The password is used for this one call and never logged.
 */
export async function giveAgentPassword({ call, need, password, marker = NO_MARKER, log = console.log }) {
  if (need === 'needs-new-password') {
    // Read first: `agent.generate` makes over an agent already made.
    const status = await call('agent.status');
    if (status?.isUnlocked) return 'unlocked';
    if (!status?.isInitialized) {
      log('[main] Making the main agent with the WE password: no keyring keeps a passphrase for it');
      const made = await call('agent.generate', { passphrase: password });
      // The agent is the WE password's now: a note of a passphrase kept for an earlier one is stale.
      marker.forget();
      if (made?.error) log('[main] The main agent was made, with an error:', made.error);
      return 'unlocked';
    }
  }
  let after;
  try {
    after = await call('agent.unlock', { passphrase: password, holochain: true });
  } catch (err) {
    if (!err?.refused) throw err;
    log('[main] The WE password did not unlock the main agent');
    return 'wrong';
  }
  return after?.isUnlocked ? 'unlocked' : 'wrong';
}

/**
 * Unlocks the agent with the kept `passphrase`: `'unlocked'`, noted as kept, or `'locked'` (left to
 * sign-in) where it does not.
 */
async function unlockWith(call, passphrase, marker, log) {
  // `agent.unlock` answers with the agent's status.
  let after;
  try {
    after = await call('agent.unlock', { passphrase, holochain: true });
  } catch (err) {
    log('[main] The kept passphrase did not unlock the main agent; it stays locked until sign-in:', err?.message);
    return 'locked';
  }
  if (after?.isUnlocked) {
    marker.note();
    return 'unlocked';
  }
  log('[main] The main agent is still locked after unlocking; it stays locked until sign-in');
  return 'locked';
}

/** Whether the keyring refused, logged with its reason (which holds no secret). */
function refusal(answer) {
  if (!answer?.refused) return false;
  console.error(
    '[main] The keyring refused:',
    answer.refused,
    answer.reason ? `(${String(answer.reason).slice(0, 200)})` : '',
  );
  return true;
}

/** The passphrase in a keyring's answer that is not a refusal ({@link refusal}), null for none. */
function kept(answer) {
  return typeof answer?.passphrase === 'string' && answer.passphrase ? answer.passphrase : null;
}

/**
 * How long the helper may take. Its own wait on a locked keyring is bounded at 90 s (custody's
 * `UNLOCK_WAIT`), so this only ends a helper that hangs past that.
 */
const HELPER_TIMEOUT_MS = 100_000;

/**
 * The keyring, through `we-custody wallet-passphrase <read|make> --data-folder <dataFolder>`: its
 * one line of JSON, `{passphrase}`, `{none: true}` or `{refused, reason?}`. A helper that fails or
 * answers nothing readable is an unavailable keyring; one that takes past `timeoutMs` is stopped
 * and is a locked one (a keyring prompt nobody answered). No credential reaches it.
 */
export function walletKeyring({ binary, dataFolder, baseEnv = process.env, timeoutMs = HELPER_TIMEOUT_MS }) {
  const env = withoutCustodyCredential(baseEnv);
  delete env.AD4M_ADMIN_CREDENTIAL;
  const ask = (mode) =>
    new Promise((resolve) => {
      let out = '';
      let settled = false;
      const done = (answer) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(answer);
      };
      const child = spawn(binary, ['wallet-passphrase', mode, '--data-folder', dataFolder], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        done({ refused: 'locked' });
      }, timeoutMs);
      child.stdout.on('data', (chunk) => (out += chunk.toString('utf8')));
      // Its stderr holds no secret: a reason, at most.
      child.stderr.on('data', (chunk) => process.stderr.write(chunk));
      child.on('error', (err) =>
        done({ refused: 'unavailable', reason: `the keyring helper did not start: ${err.code}` }),
      );
      child.on('close', (code) => {
        let answer = null;
        try {
          answer = JSON.parse(out.split('\n')[0]);
        } catch {
          // Not an answer: below.
        }
        out = '';
        if (code === 0 && answer && typeof answer === 'object') done(answer);
        else done({ refused: 'unavailable', reason: `the keyring helper exited ${code}` });
      });
    });
  return { read: () => ask('read'), make: () => ask('make') };
}

/**
 * Making the agent starts Holochain and loads the core languages before it answers, which can take
 * minutes on a slow computer.
 */
const CALL_TIMEOUT_MS = 10 * 60_000;

/**
 * Calls on the executor's WebSocket (`/api/v1/ws`) with the admin credential: `{id, type, params}`
 * out, `{id, result}` or `{id, error: {message}}` back; anything without an id (an event) is not an
 * answer. `call` rejects on the executor's error (marked `refused: true`: it answered, and said no), a
 * closed socket, or `timeoutMs`.
 */
export function executorRpc({ port, token, timeoutMs = CALL_TIMEOUT_MS }) {
  const socket = new globalThis.WebSocket(`ws://127.0.0.1:${port}/api/v1/ws?token=${encodeURIComponent(token)}`);
  const pending = new Map();
  let nextId = 1;
  let closed = null;
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('the executor’s WebSocket did not open')), { once: true });
  });
  opened.catch(() => {});
  const fail = (reason) => {
    closed = reason;
    for (const { reject } of pending.values()) reject(new Error(reason));
    pending.clear();
  };
  socket.addEventListener('close', () => fail('the executor’s WebSocket closed'));
  socket.addEventListener('message', (event) => {
    let answer;
    try {
      answer = JSON.parse(String(event.data));
    } catch {
      return;
    }
    const waiting = answer?.id && pending.get(answer.id);
    if (!waiting) return;
    pending.delete(answer.id);
    clearTimeout(waiting.timer);
    if (answer.error)
      waiting.reject(Object.assign(new Error(answer.error.message ?? 'the executor refused'), { refused: true }));
    else waiting.resolve(answer.result);
  });
  return {
    async call(method, params = {}) {
      await opened;
      if (closed) throw new Error(closed);
      const id = `main-agent-${nextId++}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`the executor did not answer ${method}`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, type: method, params }));
      });
    },
    close() {
      for (const { timer } of pending.values()) clearTimeout(timer);
      socket.close();
    },
  };
}
