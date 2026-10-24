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
