/**
 * The executor's log, on disk, beside the account it belongs to.
 *
 * The executor logs to stdout and nowhere else. The ADAM launcher gave that a home — it pointed the
 * executor's logger at `~/.ad4m/ad4m.log` — and the host that replaced it did not: output was
 * forwarded to this process's own stdout, which in a packaged build is attached to nothing. A crash
 * in the field left no record at all.
 *
 * ## Where, and under what name
 *
 * `<data path>/ad4m.log`, the file the launcher wrote and `ad4m log` still reads. Per account
 * rather than in the app's own logs directory, for three reasons: a run belongs to one agent and
 * names its perspectives, so it should leave with that agent when the account is removed; a switch
 * restarts the executor, so a shared series would let switching back and forth push out the run
 * somebody wanted; and `mv ~/.ad4m ~/.ad4m-old` stays a complete reset (see `accounts.js`).
 *
 * ## Five runs, not one
 *
 * The launcher truncated its file on every start, so a crash followed by a relaunch erased the one
 * run worth reading. Here each start shifts the previous runs down — `ad4m.log` → `ad4m.1.log` … —
 * and the oldest falls off. The index goes before the extension so every copy still opens as a
 * `.log` and `ad4m*.log` finds them all.
 *
 * ## Bounded
 *
 * Each file stops growing at a ceiling, with a line saying so. Five runs at `trace` is otherwise
 * gigabytes, and nothing else on the machine would ever reclaim it.
 *
 * The Tauri host keeps the same files by the same rules in `src-tauri/src/executor_log.rs`; the
 * two must agree, since both run against the same accounts.
 */
import { closeSync, existsSync, mkdirSync, openSync, renameSync, writeSync } from 'fs';
import { join } from 'path';
import { format } from 'util';

export const LOG_FILE_NAME = 'ad4m.log';
/** Runs kept, the current one included. */
export const KEPT_RUNS = 5;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** `ad4m.log` for the current run, `ad4m.<n>.log` for the run `n` starts ago. */
export function logFileName(index) {
  return index === 0 ? LOG_FILE_NAME : LOG_FILE_NAME.replace(/\.log$/, `.${index}.log`);
}

/**
 * Shift the previous runs down one place, dropping the oldest, so `ad4m.log` is free for this one.
 *
 * Best effort per file: a copy that cannot be moved costs one old run, which is no reason to start
 * the executor without a log.
 */
export function rotateLogs(dir, keep = KEPT_RUNS) {
  for (let index = keep - 1; index >= 1; index--) {
    const from = join(dir, logFileName(index - 1));
    if (!existsSync(from)) continue;
    try {
      renameSync(from, join(dir, logFileName(index)));
    } catch {
      // Left where it is; the next rotation tries again.
    }
  }
}

const ESC = 0x1b;

/**
 * Removes ANSI escape sequences from a byte stream, carrying a sequence split across chunks.
 *
 * The file is read in an editor, where colour codes are noise; the terminal keeps its colour
 * because only what is written here is filtered. Byte-level rather than a regex over a string,
 * because a chunk boundary can fall inside a multi-byte character as easily as inside an escape,
 * and decoding each chunk separately would mangle the first.
 *
 * Handles CSI (`ESC [ … final`), which is all a logger's colours use, and drops the single byte
 * after a bare ESC otherwise.
 */
export function createAnsiStripper() {
  let state = 'text';
  return (chunk) => {
    const out = Buffer.allocUnsafe(chunk.length);
    let length = 0;
    for (const byte of chunk) {
      if (state === 'text') {
        if (byte === ESC) state = 'escape';
        else out[length++] = byte;
      } else if (state === 'escape') {
        state = byte === 0x5b ? 'csi' : 'text';
      } else if (byte >= 0x40 && byte <= 0x7e) {
        state = 'text';
      }
    }
    return out.subarray(0, length);
  };
}

/**
 * Open this run's log in `dir`, rotating the previous ones first.
 *
 * Returns null when the file cannot be opened — a read-only data directory, a permissions problem —
 * after saying so. The executor starts either way; a log is not worth refusing to run over.
 */
export function openExecutorLog(dir, { keep = KEPT_RUNS, maxBytes = MAX_FILE_BYTES, onError = console.warn } = {}) {
  let fd;
  const path = join(dir, LOG_FILE_NAME);
  try {
    mkdirSync(dir, { recursive: true });
    rotateLogs(dir, keep);
    fd = openSync(path, 'w');
  } catch (err) {
    onError(`[main] Could not open the executor log at ${path}: ${err.message}`);
    return null;
  }

  const strip = createAnsiStripper();
  let written = 0;
  let capped = false;

  function append(bytes) {
    if (fd === undefined || capped || bytes.length === 0) return;
    try {
      if (written + bytes.length > maxBytes) {
        capped = true;
        writeSync(
          fd,
          `\n[${new Date().toISOString()} HOST] This log reached its size limit; later output is not kept.\n`,
        );
        return;
      }
      writeSync(fd, bytes);
      written += bytes.length;
    } catch {
      // A failed write (disk full) drops that chunk; the executor's own output is unaffected.
    }
  }

  return {
    path,
    /** Raw executor output, as it arrives from its stdout or stderr. */
    write(chunk) {
      append(strip(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
    },
    /**
     * A line from this process, marked so it reads apart from the executor's own. `level` is the
     * console method it came from; only a warning or an error says so, which keeps the ordinary
     * narration of a start quiet to scan.
     */
    host(level, ...args) {
      const marker = level === 'warn' || level === 'error' ? `HOST ${level.toUpperCase()}` : 'HOST';
      append(Buffer.from(`[${new Date().toISOString()} ${marker}] ${format(...args)}\n`));
    },
    close() {
      if (fd === undefined) return;
      try {
        closeSync(fd);
      } catch {
        // Already gone.
      }
      fd = undefined;
    },
  };
}
