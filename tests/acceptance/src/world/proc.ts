/**
 * A process of the world: started in its own process group, its output written line by line to a
 * log file, and stopped with every process it started.
 */
import { type ChildProcess, spawn, type SpawnOptions } from 'node:child_process';
import { createWriteStream, type WriteStream } from 'node:fs';
import { createInterface } from 'node:readline';

export interface ProcOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Where its output goes. Scanned for secrets after the scenario. */
  log: string;
}

export class Proc {
  readonly child: ChildProcess;
  private readonly lines: string[] = [];
  private readonly waiters: { match: (line: string) => boolean; resolve: (line: string) => void }[] = [];
  private readonly out: WriteStream;
  private exited: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  private readonly exitPromise: Promise<void>;

  constructor(
    readonly label: string,
    command: string,
    args: string[],
    options: ProcOptions,
  ) {
    this.out = createWriteStream(options.log, { flags: 'a' });
    const spawnOptions: SpawnOptions = {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Its own process group, so that stopping it stops what it started too.
      detached: true,
    };
    this.child = spawn(command, args, spawnOptions);
    for (const stream of [this.child.stdout, this.child.stderr]) {
      if (!stream) continue;
      createInterface({ input: stream }).on('line', (line) => this.take(line));
    }
    this.exitPromise = new Promise((resolve) => {
      this.child.on('exit', (code, signal) => {
        this.exited = { code, signal };
        this.out.write(`[world] ${label} exited: code ${code}, signal ${signal}\n`);
        resolve();
      });
      this.child.on('error', (error) => {
        this.exited = { code: null, signal: null };
        this.out.write(`[world] ${label} could not start: ${error.message}\n`);
        resolve();
      });
    });
    if (process.env.ACCEPTANCE_VERBOSE) {
      this.child.stdout?.on('data', (d) => process.stderr.write(`[${label}] ${d}`));
      this.child.stderr?.on('data', (d) => process.stderr.write(`[${label}] ${d}`));
    }
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  /** How it ended, or null while it runs. */
  get exit() {
    return this.exited;
  }

  private take(line: string) {
    this.lines.push(line);
    if (this.lines.length > 2000) this.lines.splice(0, 1000);
    this.out.write(`${line}\n`);
    for (const waiter of [...this.waiters]) {
      if (waiter.match(line)) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(line);
      }
    }
  }

  /** The first line, seen or still to come, that `match` accepts. */
  waitFor(match: (line: string) => boolean, timeoutMs: number, what: string): Promise<string> {
    const seen = this.lines.find(match);
    if (seen !== undefined) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const waiter = { match, resolve: (line: string) => (clearTimeout(timer), resolve(line)) };
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error(`${this.label}: no ${what} in ${timeoutMs / 1000} s; last lines:\n${this.tail(30)}`));
      }, timeoutMs);
      this.waiters.push(waiter);
      void this.exitPromise.then(() => {
        if (!this.waiters.includes(waiter)) return;
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        clearTimeout(timer);
        reject(new Error(`${this.label} exited before ${what}; last lines:\n${this.tail(30)}`));
      });
    });
  }

  tail(n: number): string {
    return this.lines.slice(-n).join('\n');
  }

  /** Waits for it to end by itself. */
  async done(): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    await this.exitPromise;
    return this.exited!;
  }

  /** Stops it and its process group: SIGTERM, then SIGKILL after `graceMs`. */
  async stop(graceMs = 5000): Promise<void> {
    const pid = this.child.pid;
    if (pid !== undefined && !this.exited) {
      signalGroup(pid, 'SIGTERM');
      const timer = setTimeout(() => signalGroup(pid, 'SIGKILL'), graceMs);
      await this.exitPromise;
      clearTimeout(timer);
    }
    // A process of the group can outlive its leader (a WebKit web process): end the group.
    if (pid !== undefined) signalGroup(pid, 'SIGKILL');
    await new Promise<void>((resolve) => this.out.end(resolve));
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is gone.
  }
}

/** Whether any process of a group is still running. */
export function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}
