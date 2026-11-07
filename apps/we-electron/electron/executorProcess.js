/**
 * Stopping executors: only the ones this account owns, and gracefully.
 *
 * ## Which
 *
 * An executor holds its data path exclusively — the lair-keystore socket, the Holochain conductor
 * and every perspective's RocksDB store live under it — so the executor that must be gone before
 * this one starts is the one running on the same `--app-data-path`. Nothing else is ours to stop:
 * the ADAM launcher's executor, a second WE checkout's, a test executor on another path. Matching
 * the argument rather than keeping a PID file of our own also finds an executor that an older
 * build of this app left behind, which never wrote one.
 *
 * ## How
 *
 * The executor shuts down cleanly on SIGTERM: it stops the Holochain conductor and exits. So the
 * stop is SIGTERM, then a wait for the process to go, and SIGKILL only if it does not. SIGKILL first
 * left the conductor and the stores mid-write, which is the state the startup cleanup then had to
 * repair.
 */
import { execFileSync } from 'child_process';

const EXECUTOR_BINARY = 'ad4m-executor';
const DATA_PATH_FLAG = '--app-data-path';

/**
 * PIDs of executors running on `dataPath`, from `ps -axo pid=,command=` output. A process counts
 * when its program is the executor binary and its data path argument is exactly `dataPath`.
 */
export function executorPidsFor(psOutput, dataPath) {
  const flag = ` ${DATA_PATH_FLAG} ${dataPath}`;
  const pids = [];
  for (const line of psOutput.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!match) continue;
    const [, pid, command] = match;
    const program = command.split(` run `)[0];
    if (!program.endsWith(`/${EXECUTOR_BINARY}`) && program !== EXECUTOR_BINARY) continue;
    const at = command.indexOf(flag);
    if (at === -1) continue;
    // The path ends the command line, or the next argument starts after it.
    const after = command.slice(at + flag.length);
    if (after === '' || after.startsWith(' --')) pids.push(Number(pid));
  }
  return pids;
}

/**
 * The environment the executor is started with.
 *
 * `AD4M_EXIT_WITH_PARENT`: the executor shuts down once this app's process is gone, however it
 * ended. It runs detached, in its own session, so a terminal's Ctrl+C or hangup never reaches it.
 * `--watch-stdin` (see {@link executorArgs}) does the same through the pipe this app holds; the
 * variable stays for an executor that predates the flag. An inherited value wins, so
 * `AD4M_EXIT_WITH_PARENT=false` keeps the executor running past the app, to attach a debugger to it
 * or read its state after a crash.
 *
 * Log levels are not here: they are `log_config` in the executor's config file
 * ({@link initialExecutorConfig}). An inherited `RUST_LOG` still reaches the executor and wins over
 * the file — someone who exported one before launching is debugging something specific.
 */
export function executorEnv(env = process.env) {
  return { AD4M_EXIT_WITH_PARENT: 'true', ...env };
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

/** Stops every executor running on `dataPath`. Logs what it stopped through `log(line)`. */
export async function stopExecutorsFor(dataPath, log = console.log) {
  if (process.platform === 'win32') return;
  let psOutput;
  try {
    // `ww`: without it, `ps` cuts each line to `COLUMNS` when that is set, which drops
    // `--app-data-path` (it comes after the binary path and the port) and the match misses.
    psOutput = execFileSync('ps', ['-axwwo', 'pid=,command='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch (err) {
    log(`[main] Could not list processes, not stopping a previous executor: ${err.message}`);
    return;
  }
  for (const pid of executorPidsFor(psOutput, dataPath).filter((p) => p !== process.pid)) {
    log(`[main] Stopping the executor already running on ${dataPath} (pid ${pid})`);
    const how = await stopProcess(pid);
    log(`[main] Previous executor stopped (${how})`);
  }
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
 *   reads the code itself and fails on its own (see `startExecutor`).
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
 * to every user of the computer through `ps`. `--app-data-path` stays a flag, followed by another
 * flag, because `executorPidsFor` finds a running executor by it.
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
