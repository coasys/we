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

import { afterExecutorExit, executorPidsFor, restartBudget, stopExecutorsFor, stopProcess } from './executorProcess.js';

describe('restartBudget', () => {
  const MIN = 60_000;
  /** A budget on a clock the test moves, and `crash(upFor)`: an executor that ran `upFor` exits now. */
  const setup = () => {
    let t = 0;
    const mayRestart = restartBudget({ limit: 3, healthyMs: 5 * MIN, now: () => t });
    return (upFor) => {
      const startedAt = t;
      t += upFor;
      return mayRestart(startedAt);
    };
  };

  it('allows three quick restarts in a row, then refuses', () => {
    const crash = setup();
    expect([crash(1_000), crash(1_000), crash(1_000), crash(1_000)]).toEqual([true, true, true, false]);
  });

  it('allows a restart again once an executor has run healthily', () => {
    const crash = setup();
    expect([crash(1_000), crash(1_000), crash(1_000)]).toEqual([true, true, true]);
    // Started by hand after the budget ran out, say, and stayed up.
    expect(crash(5 * MIN)).toBe(true);
    expect([crash(1_000), crash(1_000)]).toEqual([true, true]);
    expect(crash(1_000)).toBe(false);
  });

  it('allows an executor that crashes now and then, 30 min apart, to be restarted every time', () => {
    const crash = setup();
    for (let i = 0; i < 10; i++) expect(crash(30 * MIN)).toBe(true);
  });

  // A sliding 3-per-minute window never filled for this one, so it was restarted forever.
  it('refuses an executor that crashes 30 s after every start, after three restarts', () => {
    const crash = setup();
    const allowed = Array.from({ length: 10 }, () => crash(30_000));
    expect(allowed).toEqual([true, true, true, false, false, false, false, false, false, false]);
  });
});

describe('afterExecutorExit', () => {
  const exit = (state) => {
    let asked = 0;
    const outcome = afterExecutorExit({ current: true, quitting: false, appUp: true, startedAt: 0, ...state }, () => {
      asked += 1;
      return state.budgetLeft ?? true;
    });
    return { outcome, asked };
  };

  it('restarts the current executor once the app is up, spending the budget', () => {
    expect(exit({})).toEqual({ outcome: 'restart', asked: 1 });
  });

  it('gives up when the budget is spent', () => {
    expect(exit({ budgetLeft: false })).toEqual({ outcome: 'give-up', asked: 1 });
  });

  it('leaves an executor that this app stopped alone, without spending the budget', () => {
    expect(exit({ current: false })).toEqual({ outcome: 'stopped', asked: 0 });
    expect(exit({ quitting: true })).toEqual({ outcome: 'stopped', asked: 0 });
  });

  // The first start is still waiting on it; a restart would start a second executor behind its back.
  it('does not restart before the window exists', () => {
    expect(exit({ appUp: false })).toEqual({ outcome: 'leave', asked: 0 });
  });
});

const ps = (...lines) => lines.join('\n');
const exe = '/Applications/WE.app/Contents/Resources/ad4m-executor';

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
