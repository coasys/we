/**
 * Starting, stopping and supervising the executor this app runs.
 *
 * ## Only our own
 *
 * The app stops only the executor it started: its own child, through the pipe it holds
 * ({@link stopChild}). An executor someone else runs on the same data folder — the ADAM launcher's,
 * one started from a terminal — is not ours to stop. The executor holds `executor.lock` in its data
 * folder and refuses to start beside another (exit 79, before it opens anything there), and the app
 * says so ({@link afterExecutorExit}'s `busy`).
 *
 * Startup used to find and stop any executor whose command line named this data folder, then delete
 * the lair socket and the RocksDB LOCK files under it. That was for an executor an older build left
 * running after the app died. Now one cannot outlive the app: `--watch-stdin` stops it when the pipe
 * closes, which the OS does when the app dies. And the deletions are not needed for a dead executor — lair
 * removes its own stale socket, and RocksDB locks the LOCK file rather than relying on its absence —
 * while for a live one they broke the executor that exit 79 now protects.
 *
 * ## Ready
 *
 * The executor is ready when `GET /health` on its port answers 200 `{"status":"ok"}`
 * ({@link waitForExecutorReady}). It has no GraphQL: its API is the WebSocket RPC at `/api/v1/ws`.
 *
 * ## How
 *
 * The executor shuts down cleanly on SIGTERM and when its stdin closes: it stops the Holochain
 * conductor and exits. So the stop closes stdin, then SIGTERM, then a wait for the process to go,
 * and SIGKILL only if it does not. SIGKILL first left the conductor and the stores mid-write.
 */

import http from 'http';

/**
 * The environment the executor is started with.
 *
 * This app's own, passed through unchanged: nothing here ties the executor's life to the app. That
 * is `--watch-stdin` (see {@link executorArgs}) — the executor shuts down when the pipe this app
 * holds closes, which the OS does however the app ended. It runs detached, in its own session, so a
 * terminal's Ctrl+C or hangup never reaches it. No variable keeps it running past the app: to attach
 * a debugger, or read its state after a crash, start the executor yourself from a terminal and point
 * the app at it.
 *
 * Log levels are not here: they are `log_config` in the executor's config file
 * ({@link initialExecutorConfig}). An inherited `RUST_LOG` still reaches the executor and wins over
 * the file — someone who exported one before launching is debugging something specific.
 */
export function executorEnv(env = process.env) {
  return { ...env };
}

/**
 * Poll `probe` until it answers true: `'ready'`, or `'gone'` once `gone()` says the process being
 * waited on has exited, or `'timeout'` after `attempts` tries `interval` ms apart.
 *
 * `gone` is what keeps a start that has already failed from waiting out the whole budget. An
 * executor that dies while it starts leaves nothing listening, and without it the wait polled the
 * dead port for a minute: on first launch that minute passed before the start reported its error,
 * and during a crash restart the restart queued behind it waited too.
 */
export async function waitUntilReady(probe, { gone = () => false, attempts = 120, interval = 500, wait = sleep } = {}) {
  for (let i = 0; i < attempts; i++) {
    if (gone()) return 'gone';
    if (await probe()) return 'ready';
    await wait(interval);
  }
  return 'timeout';
}

/**
 * Whether the executor on `port` says it is up: `GET /health` answering 200 with `{"status":"ok"}`,
 * which it serves once its API is listening (the WebSocket RPC at `/api/v1/ws` is on the same port).
 *
 * Only that answer counts. The check this replaced took any HTTP response as ready, so a 404 — from
 * an unrelated server on the port, or from the executor itself for a path it does not serve — passed.
 * A request that gets no answer within `timeoutMs` is not ready, and the caller asks again.
 */
export function executorHealthy(port, { timeoutMs = 2_000 } = {}) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/health', timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(false);
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body)?.status === 'ok');
        } catch {
          resolve(false);
        }
      });
      res.on('error', () => resolve(false));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

/**
 * Wait, up to 60 s at the defaults of {@link waitUntilReady}, for the executor on `port` to be
 * {@link executorHealthy}. Throws when it is not, saying whether the executor exited first (`gone`,
 * checked between attempts) or never answered.
 */
export async function waitForExecutorReady(port, { gone = () => false, attempts, interval, wait } = {}) {
  const outcome = await waitUntilReady(() => executorHealthy(port), { gone, attempts, interval, wait });
  if (outcome === 'ready') return;
  throw new Error(
    outcome === 'gone'
      ? `The executor exited before it was ready on port ${port}`
      : `The executor on port ${port} was not ready after 60 s`,
  );
}

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists but belongs to someone else, which we treat as running.
    return err.code === 'EPERM';
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function exitedWithin(pid, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) {
    if (!isAlive(pid)) return true;
  }
  return !isAlive(pid);
}

/**
 * SIGTERM, wait up to `timeoutMs`, then SIGKILL the process group (the executor is spawned as a
 * group leader) and the process. Resolves with how it ended: 'SIGTERM', 'SIGKILL' or 'gone' when it
 * was not running. Rejects when the process is running and may not be signalled (another user's), so
 * startup stops there rather than clearing locks a live executor holds.
 */
export async function stopProcess(pid, { timeoutMs = 10_000 } = {}) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    // Only ESRCH means it is not running. EPERM is a process we may not signal, which `isAlive`
    // counts as running: reporting it gone would let the cleanup remove its locks.
    if (err.code === 'ESRCH') return 'gone';
    throw err;
  }
  if (await exitedWithin(pid, timeoutMs)) return 'SIGTERM';
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, 'SIGKILL');
    } catch {
      // Not a group leader, or already gone.
    }
  }
  await exitedWithin(pid, 2_000);
  return 'SIGKILL';
}

/**
 * Stop an executor this app started with `--watch-stdin true`: close its stdin, which it answers
 * by shutting down and exiting 0, and fall back to {@link stopProcess} (SIGTERM, then SIGKILL) if
 * it has not gone within `timeoutMs`. Resolves with how it ended: 'stdin', 'SIGTERM', 'SIGKILL' or
 * 'gone'.
 */
export async function stopChild(proc, { timeoutMs = 10_000, fallback = stopProcess } = {}) {
  const gone = () => proc.exitCode !== null || proc.signalCode !== null;
  if (gone()) return 'gone';
  const exited = new Promise((resolve) => proc.once('exit', () => resolve(true)));
  proc.stdin?.end();
  const inTime = await Promise.race([exited, sleep(timeoutMs).then(() => gone())]);
  if (inTime) return 'stdin';
  return fallback(proc.pid);
}

/**
 * How long to wait before starting again an executor that crashed: 1 s, 2 s, 4 s … up to `capMs`,
 * and `null` — give up — after `limit` crashes in a row. The count ends only when an executor has
 * stayed up for `healthyMs`.
 *
 * The executor is the app's whole backend: when it dies on its own the window stays up and every
 * call fails, so starting it again is right. The delay keeps an executor that dies at once from
 * spinning; the limit stops one that keeps failing (a corrupt store) from being restarted forever,
 * and past it the exit is shown to the person. Counted in a row rather than per time window: a
 * window only catches failures faster than itself, so an executor dying 30 s after each start never
 * filled a 3-per-minute window and was restarted forever.
 *
 * Returns a function taking when the exited executor started; it answers for this exit and counts
 * the restart when it allows one.
 */
export function crashBackoff({ baseMs = 1_000, capMs = 30_000, healthyMs = 60_000, limit = 6, now = Date.now } = {}) {
  let crashes = 0;
  return (startedAt) => {
    if (now() - startedAt >= healthyMs) crashes = 0;
    if (crashes >= limit) return null;
    const delay = Math.min(capMs, baseMs * 2 ** crashes);
    crashes += 1;
    return delay;
  };
}

/** The executor's exit codes: its run contract with whatever supervises it (ad4m `exit.rs`). */
export const EXIT = Object.freeze({
  STOPPED: 0,
  RESTART: 75,
  CONFIG_REFUSED: 78,
  DATA_FOLDER_BUSY: 79,
  PORT_TAKEN: 80,
});

/**
 * What to do about an executor that exited, from its exit code:
 *
 * - `stopped` — it was not the current executor, or the app is quitting: this app stopped it.
 * - `leave` — the current one, before the window exists. The first start is still waiting on it,
 *   reads the code itself and fails, or tries another port, on its own ({@link startWithPortRetry}).
 * - `done` — exit 0: it stopped because it was asked to (`runtime.quit`, a signal, stdin closed).
 * - `restart` — `samePort: true` for 75 (`runtime.restart`: the same arguments, at once, not
 *   counted as a crash); `samePort: false` with `delayMs` for 80 (the port is taken: another one)
 *   and for a crash, as `backoff` allows.
 * - `refused` — 78: the config file or a flag is refused. Starting again fails the same way.
 * - `busy` — 79: another executor holds the data folder. Not ours to stop.
 * - `give-up` — a crash past what `backoff` allows.
 *
 * `backoff` is a {@link crashBackoff}, consulted (and so spent) only for a crash or a taken port.
 */
export function afterExecutorExit({ current, quitting, appUp, startedAt, code, signal }, backoff) {
  if (!current || quitting) return { action: 'stopped' };
  if (!appUp) return { action: 'leave' };
  if (signal == null) {
    if (code === EXIT.STOPPED) return { action: 'done' };
    if (code === EXIT.RESTART) return { action: 'restart', samePort: true, delayMs: 0 };
    if (code === EXIT.CONFIG_REFUSED) return { action: 'refused' };
    if (code === EXIT.DATA_FOLDER_BUSY) return { action: 'busy' };
  }
  const delayMs = backoff(startedAt);
  if (delayMs === null) return { action: 'give-up' };
  return { action: 'restart', samePort: false, delayMs: code === EXIT.PORT_TAKEN && signal == null ? 0 : delayMs };
}

/**
 * Start the executor with `startOnce`, which rejects with the exit code of an executor that exited
 * before it was ready. A taken port (80) is tried again on another port, up to `attempts` starts —
 * but only while `appUp()` is false: the first start, before a window exists, when the exit handler
 * leaves the executor to it ({@link afterExecutorExit}'s `leave`). Once the window exists the exit
 * handler owns recovery: it has already queued a restart for that exit, against the crash backoff,
 * so this rejects and leaves it there. Trying here as well started an executor the queued restart
 * then stopped, and went on trying after the handler had given up.
 *
 * `samePort` is passed to the first start only: another try needs another port.
 */
export async function startWithPortRetry(startOnce, { samePort = false, appUp, attempts = 3 }) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await startOnce({ samePort: samePort && attempt === 1 });
    } catch (err) {
      if (err.exitCode !== EXIT.PORT_TAKEN || attempt >= attempts || appUp()) throw err;
      console.warn('[main] The executor’s port is taken; starting it on another one');
    }
  }
}

/**
 * The arguments the executor is started with, after `run`.
 *
 * - `--watch-stdin true`: it stops (exit 0) when its stdin closes. This app holds the pipe open
 *   and closes it to stop the executor; if the app dies, the OS closes it, and the executor ends
 *   with the app.
 * - `--log-dir`: the executor keeps its own log, one file per run, five runs
 *   (`executor-0.log` is this run), which `runtime.logTail` reads.
 * - `--config`: the file `runtime.setConfig` writes and the next start reads.
 * - `--custody-channel`: opens `identity.custodyStatus` to the custody service beside it.
 *
 * The admin credential is in the environment (`executorSpawnEnv`), not here: an argument is visible
 * to every user of the computer through `ps`.
 */
export function executorArgs({ port, dataPath, configFile, logDir }) {
  return [
    'run',
    '--port',
    String(port),
    '--app-data-path',
    dataPath,
    '--config',
    configFile,
    '--log-dir',
    logDir,
    '--watch-stdin',
    'true',
    '--custody-channel',
    'true',
    '--run-dapp-server',
    'false',
    '--connect-holochain',
    'true',
  ];
}

/**
 * The config file a data folder starts with, the first time this app starts an executor on it.
 *
 * From what an older build of this app kept in its account registry (`accounts.executorSettings`),
 * so MCP and log levels chosen there carry over; afterwards the file is where they live, and the
 * settings page writes it through `runtime.setConfig`. Only keys the executor lets a running
 * executor change (`restart` keys) — flags still set the rest.
 *
 * `auto_permit_cap_requests: true` keeps what an executor started without a config file does: with
 * one, the executor's default turns to `false`. A person can change it on the settings page.
 */
export function initialExecutorConfig({ mcpEnabled = false, mcpPort, logLevels } = {}) {
  return {
    mcp_enabled: mcpEnabled === true,
    ...(mcpPort ? { mcp_port: mcpPort } : {}),
    ...(logLevels && Object.keys(logLevels).length ? { log_config: { ...logLevels } } : {}),
    auto_permit_cap_requests: true,
  };
}

/**
 * The last `max` lines of a process's output, for saying why it stopped. Chunks arrive cut anywhere;
 * a line is kept once it is whole, and `lines()` adds a partial last one.
 */
export function outputTail(max = 20) {
  const kept = [];
  let partial = '';
  return {
    push(chunk) {
      const text = partial + String(chunk);
      const parts = text.split(/\r?\n/);
      partial = parts.pop() ?? '';
      for (const line of parts) {
        if (!line.trim()) continue;
        kept.push(line);
        if (kept.length > max) kept.shift();
      }
    },
    lines() {
      return partial.trim() ? [...kept, partial].slice(-max) : [...kept];
    },
  };
}
