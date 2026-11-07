/**
 * Which executors this app may stop, and how it stops one — against real processes for the latter.
 *
 * The selection is the part worth pinning: it used to be `pkill -f ad4m-executor`, which also ended
 * every other app's executor on the machine, a second WE checkout's, test executors and any command
 * line that merely mentioned the binary.
 */
import { spawn } from 'child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import {
  afterExecutorExit,
  crashBackoff,
  executorArgs,
  executorEnv,
  executorPidsFor,
  EXIT,
  initialExecutorConfig,
  outputTail,
  stopChild,
  stopExecutorsFor,
  stopProcess,
  waitUntilReady,
} from './executorProcess.js';

describe('crashBackoff', () => {
  const MIN = 60_000;
  /** A backoff on a clock the test moves, and `crash(upFor)`: an executor that ran `upFor` exits now. */
  const setup = (options = {}) => {
    let t = 0;
    const backoff = crashBackoff({ healthyMs: MIN, now: () => t, ...options });
    return (upFor) => {
      const startedAt = t;
      t += upFor;
      return backoff(startedAt);
    };
  };

  it('waits 1 s, 2 s, 4 s … up to the cap, then gives up', () => {
    const crash = setup({ limit: 8 });
    const delays = Array.from({ length: 9 }, () => crash(1_000));
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000, null]);
  });

  it('gives up after six crashes in a row by default', () => {
    const crash = setup();
    const delays = Array.from({ length: 7 }, () => crash(1_000));
    expect(delays.at(-1)).toBeNull();
    expect(delays.slice(0, 6).every((d) => typeof d === 'number')).toBe(true);
  });

  it('starts from 1 s again once an executor has stayed up a minute', () => {
    const crash = setup();
    expect([crash(1_000), crash(1_000), crash(1_000)]).toEqual([1_000, 2_000, 4_000]);
    expect(crash(MIN)).toBe(1_000);
    expect(crash(1_000)).toBe(2_000);
  });

  it('restarts an executor that crashes now and then, an hour apart, every time at once', () => {
    const crash = setup();
    for (let i = 0; i < 10; i++) expect(crash(60 * MIN)).toBe(1_000);
  });
});

describe('afterExecutorExit', () => {
  const exit = (state) => {
    let asked = 0;
    const outcome = afterExecutorExit({ current: true, quitting: false, appUp: true, startedAt: 0, ...state }, () => {
      asked += 1;
      return state.delay === undefined ? 1_000 : state.delay;
    });
    return { ...outcome, asked };
  };

  it('restarts a crashed executor after the backoff, with a new port', () => {
    expect(exit({ code: 1 })).toEqual({ action: 'restart', samePort: false, delayMs: 1_000, asked: 1 });
    expect(exit({ code: null, signal: 'SIGKILL' })).toEqual({
      action: 'restart',
      samePort: false,
      delayMs: 1_000,
      asked: 1,
    });
  });

  it('gives up on a crash once the backoff does', () => {
    expect(exit({ code: 1, delay: null })).toEqual({ action: 'give-up', asked: 1 });
  });

  it('is done when the executor stopped because it was asked to (0)', () => {
    expect(exit({ code: EXIT.STOPPED })).toEqual({ action: 'done', asked: 0 });
  });

  it('starts it again at once with the same arguments for runtime.restart (75), not as a crash', () => {
    expect(exit({ code: EXIT.RESTART })).toEqual({ action: 'restart', samePort: true, delayMs: 0, asked: 0 });
  });

  it('does not restart a refused config (78) or a data folder another executor holds (79)', () => {
    expect(exit({ code: EXIT.CONFIG_REFUSED })).toEqual({ action: 'refused', asked: 0 });
    expect(exit({ code: EXIT.DATA_FOLDER_BUSY })).toEqual({ action: 'busy', asked: 0 });
  });

  it('starts again on another port at once when the port is taken (80), counted against the backoff', () => {
    expect(exit({ code: EXIT.PORT_TAKEN })).toEqual({ action: 'restart', samePort: false, delayMs: 0, asked: 1 });
    expect(exit({ code: EXIT.PORT_TAKEN, delay: null })).toEqual({ action: 'give-up', asked: 1 });
  });

  // A signal is a crash whatever the code field says.
  it('reads an exit by a signal as a crash', () => {
    expect(exit({ code: null, signal: 'SIGSEGV' }).action).toBe('restart');
  });

  it('leaves an executor that this app stopped alone, without spending the backoff', () => {
    expect(exit({ current: false, code: 1 })).toEqual({ action: 'stopped', asked: 0 });
    expect(exit({ quitting: true, code: 1 })).toEqual({ action: 'stopped', asked: 0 });
  });

  // The first start is still waiting on it and reads the code itself.
  it('does not act before the window exists', () => {
    expect(exit({ appUp: false, code: 1 })).toEqual({ action: 'leave', asked: 0 });
  });
});

describe('executorArgs', () => {
  const args = executorArgs({ port: 12001, dataPath: '/d/a b', configFile: '/d/a b/c.json', logDir: '/d/a b/logs' });

  it('starts the executor under the run contract', () => {
    const flag = (name) => args[args.indexOf(name) + 1];
    expect(args[0]).toBe('run');
    expect(flag('--port')).toBe('12001');
    expect(flag('--watch-stdin')).toBe('true');
    expect(flag('--config')).toBe('/d/a b/c.json');
    expect(flag('--log-dir')).toBe('/d/a b/logs');
    expect(flag('--custody-channel')).toBe('true');
  });

  // `executorPidsFor` finds a running executor by its data path, which another flag must follow.
  it('is found again by its data path', () => {
    const line = `  42 /opt/ad4m-executor ${args.join(' ')}`;
    expect(executorPidsFor(line, '/d/a b')).toEqual([42]);
  });
});

describe('initialExecutorConfig', () => {
  it('carries the settings an older build kept over into the file', () => {
    expect(initialExecutorConfig({ mcpEnabled: true, mcpPort: 3005, logLevels: { holochain: 'warn' } })).toEqual({
      mcp_enabled: true,
      mcp_port: 3005,
      log_config: { holochain: 'warn' },
      auto_permit_cap_requests: true,
    });
  });

  // With a config file the executor's default turns to false; an executor without one permits.
  it('keeps capability requests permitted, as without a config file', () => {
    expect(initialExecutorConfig()).toEqual({ mcp_enabled: false, auto_permit_cap_requests: true });
  });
});

describe('outputTail', () => {
  it('keeps the last whole lines, across chunks cut anywhere', () => {
    const tail = outputTail(2);
    tail.push('one\ntw');
    tail.push('o\n\nthree\nfou');
    expect(tail.lines()).toEqual(['three', 'fou']);
    tail.push('r\n');
    expect(tail.lines()).toEqual(['three', 'four']);
  });
});

describe('executorEnv', () => {
  it('tells the executor to end with this app, however the app ends', () => {
    expect(executorEnv({ PATH: '/bin' })).toEqual({ PATH: '/bin', AD4M_EXIT_WITH_PARENT: 'true' });
  });

  it('passes an inherited RUST_LOG through', () => {
    expect(executorEnv({ RUST_LOG: 'trace' }).RUST_LOG).toBe('trace');
  });

  // To attach a debugger to the executor, or read its state after the app crashed.
  it('leaves an inherited AD4M_EXIT_WITH_PARENT alone', () => {
    expect(executorEnv({ AD4M_EXIT_WITH_PARENT: 'false' }).AD4M_EXIT_WITH_PARENT).toBe('false');
  });
});

describe('stopChild', () => {
  /** A child that exits 0 when its stdin ends, as `--watch-stdin true` does, or one that ignores it. */
  const watcher = (ignoreStdin) => {
    const code = ignoreStdin
      ? "process.stdin.resume(); console.log('up'); setInterval(() => {}, 1000)"
      : "process.stdin.on('end', () => process.exit(0)); process.stdin.resume(); console.log('up')";
    const proc = spawn(process.execPath, ['-e', code], { stdio: ['pipe', 'pipe', 'ignore'] });
    return new Promise((resolve) => proc.stdout.once('data', () => resolve(proc)));
  };

  it('stops it by closing its stdin, without a signal', async () => {
    const proc = await watcher(false);
    const exited = new Promise((r) => proc.once('exit', (code, signal) => r({ code, signal })));
    expect(await stopChild(proc, { timeoutMs: 5000 })).toBe('stdin');
    expect(await exited).toEqual({ code: 0, signal: null });
  });

  it('falls back to signals when it does not stop in time', async () => {
    const proc = await watcher(true);
    let fellBackFor = null;
    const how = await stopChild(proc, {
      timeoutMs: 200,
      fallback: async (pid) => {
        fellBackFor = pid;
        proc.kill('SIGKILL');
        return 'SIGKILL';
      },
    });
    expect(how).toBe('SIGKILL');
    expect(fellBackFor).toBe(proc.pid);
  });
});

const ps = (...lines) => lines.join('\n');
const exe = '/Applications/WE.app/Contents/Resources/ad4m-executor';

describe('waitUntilReady', () => {
  /** A probe answering `answers` in turn, and a wait that takes no time. */
  const setup = (answers) => {
    let asked = 0;
    const probe = async () => answers[asked++] ?? false;
    return { probe, asked: () => asked, wait: async () => {} };
  };

  it('is ready once the probe answers', async () => {
    const { probe, asked, wait } = setup([false, false, true]);
    expect(await waitUntilReady(probe, { wait })).toBe('ready');
    expect(asked()).toBe(3);
  });

  it('times out after its attempts', async () => {
    const { probe, asked, wait } = setup([]);
    expect(await waitUntilReady(probe, { attempts: 5, wait })).toBe('timeout');
    expect(asked()).toBe(5);
  });

  // An executor that died while it started: on dev the wait polled its dead port for a minute.
  it('stops as soon as the process it waits on is gone', async () => {
    const { probe, asked, wait } = setup([]);
    let exited = false;
    const outcome = waitUntilReady(
      async () => {
        const answer = await probe();
        if (asked() === 2) exited = true;
        return answer;
      },
      { gone: () => exited, wait },
    );
    expect(await outcome).toBe('gone');
    expect(asked()).toBe(2);
  });
});

describe('executorPidsFor', () => {
  it('finds the executor running on this data path', () => {
    const out = ps(
      `  101 ${exe} run --port 12000 --admin-credential x --app-data-path /Users/a/.ad4m --run-dapp-server false`,
      `  102 /usr/bin/other --app-data-path /Users/a/.ad4m`,
    );
    expect(executorPidsFor(out, '/Users/a/.ad4m')).toEqual([101]);
  });

  it('leaves executors on other data paths alone, including a path that only starts the same', () => {
    const out = ps(
      `  201 ${exe} run --port 12000 --app-data-path /Users/a/.ad4m-other --run-dapp-server false`,
      `  202 ${exe} run --port 12400 --app-data-path /tmp/test/data`,
      `  203 /Applications/ADAM Launcher.app/Contents/MacOS/ad4m-executor run --app-data-path /Users/a/.ad4m-launcher`,
    );
    expect(executorPidsFor(out, '/Users/a/.ad4m')).toEqual([]);
  });

  it('matches the path as the last argument and a path with spaces', () => {
    const out = ps(
      `  301 ${exe} run --app-data-path /Users/a/My Data`,
      `  302 ${exe} run --app-data-path /Users/a/My Data/sub --port 1`,
    );
    expect(executorPidsFor(out, '/Users/a/My Data')).toEqual([301]);
  });

  it('ignores commands that only mention the binary', () => {
    const out = ps(
      `  401 cargo build --release -p ad4m --bin ad4m-executor --app-data-path /Users/a/.ad4m`,
      `  402 tail -f /Users/a/.ad4m/ad4m-executor.log --app-data-path /Users/a/.ad4m`,
    );
    expect(executorPidsFor(out, '/Users/a/.ad4m')).toEqual([]);
  });
});

/** A child that exits on SIGTERM, or one that ignores it. Resolves once it is running. */
function child(ignoreTerm) {
  const code = ignoreTerm
    ? "process.on('SIGTERM', () => {}); console.log('up'); setInterval(() => {}, 1000)"
    : "process.on('SIGTERM', () => process.exit(0)); console.log('up'); setInterval(() => {}, 1000)";
  const proc = spawn(process.execPath, ['-e', code], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  return new Promise((resolve) => proc.stdout.once('data', () => resolve(proc)));
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe.skipIf(process.platform === 'win32')('stopProcess', () => {
  it('stops a process that honours SIGTERM, without SIGKILL', async () => {
    const proc = await child(false);
    const exited = new Promise((r) => proc.once('exit', (code, signal) => r({ code, signal })));
    expect(await stopProcess(proc.pid, { timeoutMs: 5000 })).toBe('SIGTERM');
    expect(await exited).toEqual({ code: 0, signal: null });
  });

  it('kills a process that ignores SIGTERM once the timeout passes', async () => {
    const proc = await child(true);
    const exited = new Promise((r) => proc.once('exit', (code, signal) => r(signal)));
    expect(await stopProcess(proc.pid, { timeoutMs: 300 })).toBe('SIGKILL');
    expect(await exited).toBe('SIGKILL');
    expect(alive(proc.pid)).toBe(false);
  });

  it('treats a process that is already gone as stopped', async () => {
    const proc = await child(false);
    proc.kill('SIGKILL');
    await new Promise((r) => proc.once('exit', r));
    expect(await stopProcess(proc.pid, { timeoutMs: 300 })).toBe('gone');
  });

  // Signalling pid 1 as root would send init a SIGTERM, so only run this where it is refused.
  it.skipIf(process.getuid?.() === 0)('rejects for a running process it may not signal', async () => {
    await expect(stopProcess(1, { timeoutMs: 300 })).rejects.toMatchObject({ code: 'EPERM' });
  });
});

describe.skipIf(process.platform === 'win32')('stopExecutorsFor', () => {
  // `COLUMNS` makes `ps` cut each line to that width. The executor's data path comes after the
  // binary path and the admin credential, so a cut line no longer names it and the match misses.
  it('finds an executor whose data path is past the terminal width', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'we-executor-'));
    const exePath = join(dir, 'ad4m-executor');
    writeFileSync(exePath, "#!/bin/sh\ntrap 'exit 0' TERM\nwhile :; do sleep 0.1; done\n");
    chmodSync(exePath, 0o755);
    const dataPath = join(dir, 'data');
    const proc = spawn(exePath, ['run', '--admin-credential', 'x'.repeat(80), '--app-data-path', dataPath], {
      stdio: 'ignore',
    });
    const exited = new Promise((r) => proc.once('exit', r));
    const columns = process.env.COLUMNS;
    process.env.COLUMNS = '80';
    try {
      const lines = [];
      await stopExecutorsFor(dataPath, (line) => lines.push(line));
      expect(lines).toContain(`[main] Stopping the executor already running on ${dataPath} (pid ${proc.pid})`);
      await exited;
    } finally {
      if (columns === undefined) delete process.env.COLUMNS;
      else process.env.COLUMNS = columns;
      proc.kill('SIGKILL');
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
