/**
 * The custody service, as the `we-custody` sidecar (`crates/custody`, `src/sidecar.rs`): the person's
 * master key and the identity flows, in a process of its own beside the executor. The Tauri app
 * links the same crate; here it is a child process because the main process is Node.
 *
 * It speaks lines of JSON: a request `{id, method, params}` on its stdin, the answer `{id, result}`
 * or `{id, error}` on its stdout, in the order they finish. It exits when its stdin closes, so it
 * never outlives this process.
 *
 * The admin credential reaches it in its environment, never on its command line, which every user
 * of the computer can read through `ps`.
 */
import { spawn } from 'child_process';
import { createInterface } from 'readline';

import { stopProcess } from './executorProcess.js';
import { executorSpawnEnv } from './ipcSender.js';

/** How long a closing sidecar has to exit on its own before it is killed. */
const EXIT_GRACE_MS = 3_000;

/** The command, arguments and environment of one sidecar start. */
export function custodySpawn({ binary, executorPort, credential, baseEnv }) {
  return {
    command: binary,
    args: ['--executor-port', String(executorPort)],
    env: executorSpawnEnv(baseEnv, credential),
  };
}

/**
 * Requests over `child`'s stdin and stdout. `call` resolves with the answer's `result`, and rejects
 * with its `error`, or when the sidecar has stopped.
 */
export function custodyClient(child) {
  let nextId = 1;
  const pending = new Map();
  let stopped = null;

  const fail = (reason) => {
    stopped = reason;
    for (const { reject } of pending.values()) reject(new Error(reason));
    pending.clear();
  };

  createInterface({ input: child.stdout }).on('line', (line) => {
    let answer;
    try {
      answer = JSON.parse(line);
    } catch {
      return;
    }
    const waiting = pending.get(answer.id);
    if (!waiting) return;
    pending.delete(answer.id);
    if ('error' in answer) waiting.reject(new Error(answer.error));
    else waiting.resolve(answer.result);
  });
  child.on('exit', () => fail('the custody service stopped'));
  child.on('error', (err) => fail(`the custody service could not start: ${err.message}`));
  // Writing to a sidecar that has just exited is answered by `exit` above, not by a throw here.
  child.stdin.on('error', () => {});

  return {
    call(method, params = {}) {
      if (stopped) return Promise.reject(new Error(stopped));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      });
    },
  };
}

/**
 * Starts the sidecar. Its stderr goes to `log` (the executor log): the crate writes no secret
 * there, and stdout carries only answers.
 */
export function startCustody({ binary, executorPort, credential, baseEnv = process.env, log = console.log }) {
  const { command, args, env } = custodySpawn({ binary, executorPort, credential, baseEnv });
  // A group of its own, as the executor's is, so a stop can reach it whatever it started.
  const child = spawn(command, args, { detached: true, stdio: ['pipe', 'pipe', 'pipe'], env });
  child.unref();
  createInterface({ input: child.stderr }).on('line', (line) => log(line));
  const client = custodyClient(child);

  return {
    call: client.call,
    /** Closes its stdin, which ends the open step and the process; kills it if it lingers. */
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
      let timer;
      const exited = new Promise((resolve) => child.once('exit', () => resolve(true)));
      const late = new Promise((resolve) => (timer = setTimeout(() => resolve(false), EXIT_GRACE_MS)));
      child.stdin.end();
      const inTime = await Promise.race([exited, late]);
      clearTimeout(timer);
      if (!inTime) await stopProcess(child.pid);
    },
  };
}
