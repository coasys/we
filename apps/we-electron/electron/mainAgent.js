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
 * What it leaves alone: an agent already unlocked; an agent made before this, with a WE password,
 * whose passphrase the keyring does not hold (it stays locked, and WE's sign-in unlocks it as it did);
 * and an agent the kept passphrase does not unlock (the same). A keyring that is locked, or that is
 * not there, fails the start, in {@link KEYRING_WORDS}: the agent cannot be made or unlocked without
 * one, and making it under a passphrase nothing keeps would lose it.
 *
 * The passphrase is never logged: this process's console is copied into the executor log
 * (`main.js`), and the words the window is given carry neither it nor a path.
 */
import { spawn } from 'child_process';

import { withoutCustodyCredential } from './executorProcess.js';

/** Why a start failed for the keyring, in words for the window: no path, no secret. */
export const KEYRING_WORDS = Object.freeze({
  locked:
    "This computer's keyring is locked, so the app cannot unlock your agent. Unlock the keyring (your login password usually does), then try again.",
  unavailable:
    "This computer has no keyring the app can keep your agent's passphrase in (on Linux, a Secret Service such as GNOME Keyring or KWallet). Start one, then try again.",
});

/**
 * Makes sure the executor's main agent exists and is unlocked. `call(method, params)` is an admin
 * call to the executor ({@link executorRpc}); `keyring` answers `read()` and `make()`
 * ({@link walletKeyring}). Resolves `'unlocked'`, or `'locked'` for an agent left to WE's sign-in;
 * rejects when the keyring refuses, or when the executor fails to make the agent.
 */
export async function ensureMainAgent({ call, keyring, log = console.log }) {
  const status = await call('agent.status');
  if (status?.isUnlocked) return 'unlocked';

  if (!status?.isInitialized) {
    const passphrase = kept(await keyring.make());
    if (passphrase === null) throw new Error(KEYRING_WORDS.unavailable);
    log('[main] Making the main agent: its passphrase is kept in this computer’s keyring');
    const made = await call('agent.generate', { passphrase });
    // Languages that did not load are the executor's to report; the agent is made either way.
    if (made?.error) log('[main] The main agent was made, with an error:', made.error);
    return 'unlocked';
  }

  const passphrase = kept(await keyring.read());
  if (passphrase === null) {
    log('[main] The main agent was made with a WE password: it stays locked until sign-in');
    return 'locked';
  }
  // `agent.unlock` answers with the agent's status.
  let after;
  try {
    after = await call('agent.unlock', { passphrase, holochain: true });
  } catch (err) {
    log('[main] The kept passphrase did not unlock the main agent; it stays locked until sign-in:', err?.message);
    return 'locked';
  }
  if (after?.isUnlocked) return 'unlocked';
  log('[main] The main agent is still locked after unlocking; it stays locked until sign-in');
  return 'locked';
}

/** The passphrase in a keyring's answer, null for none; a refusal throws its words. */
function kept(answer) {
  if (typeof answer?.passphrase === 'string' && answer.passphrase) return answer.passphrase;
  if (answer?.refused) {
    console.error(
      '[main] The keyring refused:',
      answer.refused,
      answer.reason ? `(${String(answer.reason).slice(0, 200)})` : '',
    );
    throw new Error(KEYRING_WORDS[answer.refused] ?? KEYRING_WORDS.unavailable);
  }
  return null;
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
 * answer. `call` rejects on the executor's error, a closed socket, or `timeoutMs`.
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
    if (answer.error) waiting.reject(new Error(answer.error.message ?? 'the executor refused'));
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
