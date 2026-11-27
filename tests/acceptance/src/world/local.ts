/**
 * The local world: an identity store on a temporary database, and the executors a scenario needs,
 * from the ad4m checkout the run names. Every process it starts is in its own process group and
 * stops with the world; `stop` checks that none is left.
 *
 * The executors run as ad4m's own identity suite runs them: in `<ad4m>/tests/js`, from a seed whose
 * agent language is the centralised one, with the shared test language directories, and without
 * Holochain.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Checkout } from './checkout.ts';
import { Endpoints } from './names.ts';
import { groupAlive, Proc } from './proc.ts';
import { rpc } from './rpc.ts';

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port')),
      );
    });
  });
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58(bytes: Uint8Array): string {
  let n = BigInt(`0x${Buffer.from(bytes).toString('hex') || '0'}`);
  let out = '';
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** The executor's address for a language bundle, as ad4m's test helper `languageAddress` computes it. */
export function languageAddress(bundle: string): string {
  const digest = createHash('sha256').update(bundle, 'utf8').digest();
  return `Qmz${base58(Buffer.concat([Buffer.from([0x01, 0x00, 0x12, 0x20]), digest]))}`;
}

/** An executor of the world. */
export interface ExecutorHandle {
  name: string;
  url: string;
  /** Where it keeps its data, for the scanner. */
  dataPath: string;
  log: string;
  /** World building and assertions only: a scenario acts through the apps. */
  call<T = unknown>(type: string, params?: unknown): Promise<T>;
  proc: Proc;
}

export interface ExecutorSpec {
  name: string;
  /** A `did:scid`, passed as `--operator`: the identity that may link it first. */
  operator?: string;
}

export class LocalWorld {
  readonly dir: string;
  readonly endpoints = new Endpoints();
  readonly logs: string;
  /** The seed every executor of this world starts from. */
  readonly seedPath: string;
  storeUrl = '';
  storeKey = '';
  private readonly procs: Proc[] = [];
  private readonly executors = new Map<string, ExecutorHandle>();

  private constructor(readonly checkout: Checkout) {
    this.dir = mkdtempSync(join(tmpdir(), 'we-acceptance-'));
    this.logs = join(this.dir, 'logs');
    mkdirSync(this.logs);
    this.seedPath = join(this.dir, 'seed.json');
  }

  /** Starts a world: the seed and the identity store. */
  static async start(checkout: Checkout): Promise<LocalWorld> {
    const world = new LocalWorld(checkout);
    try {
      world.writeSeed();
      await world.startStore();
      return world;
    } catch (error) {
      await world.stop();
      throw error;
    }
  }

  /**
   * The seed ad4m's identity suite last wrote, when there is one: `prepare-test-local` publishes the
   * languages it names. Otherwise the checked-in seed. Either way with the centralised agent language.
   */
  private writeSeed() {
    const js = this.checkout.testsJs;
    const agentLanguage = readFileSync(join(js, 'scripts/centralized-agent-language-hash'), 'utf8').trim();
    let source = join(js, 'tst-tmp/identityBootstrapSeed.json');
    try {
      readFileSync(source);
    } catch {
      source = join(js, 'bootstrapSeed.json');
    }
    const seed = JSON.parse(readFileSync(source, 'utf8'));
    seed.agentLanguage = agentLanguage;
    writeFileSync(this.seedPath, JSON.stringify(seed));
  }

  private async startStore() {
    const port = await freePort();
    const store = new Proc('identity-store', this.checkout.identityStore, ['serve'], {
      log: join(this.logs, 'identity-store.log'),
      env: {
        ...process.env,
        IDENTITY_STORE_DB: join(this.dir, 'store.sqlite'),
        IDENTITY_STORE_KEY: join(this.dir, 'store-key'),
        IDENTITY_STORE_LISTEN: `127.0.0.1:${port}`,
        // A cheap proof of work: the run proves the flows, not the cost.
        POW_BITS: '8',
      },
    });
    this.procs.push(store);
    const ready = await store.waitFor((l) => l.startsWith('identity-store listening on '), 30_000, 'listening line');
    // "identity-store listening on <url> with key <key>"
    const parts = ready.split(/\s+/);
    this.storeUrl = parts[3];
    this.storeKey = parts[5];
    this.endpoints.add('store', this.storeUrl);
  }

  /**
   * Writes the language settings an executor of this world needs into a data folder that `init` has
   * made: the test languages keep their data in the shared test directories.
   */
  writeLanguageSettings(dataPath: string) {
    const seed = JSON.parse(readFileSync(this.seedPath, 'utf8'));
    const shared = join(this.checkout.testsJs, 'tst-tmp');
    const set = (address: string, storage: string) => {
      const dir = join(dataPath, 'ad4m/languages', address);
      mkdirSync(dir, { recursive: true });
      mkdirSync(storage, { recursive: true });
      writeFileSync(join(dir, 'settings.json'), JSON.stringify({ storagePath: storage }));
    };
    if (seed.languageLanguageBundle) set(languageAddress(seed.languageLanguageBundle), join(shared, 'languages'));
    if (seed.neighbourhoodLanguage) set(seed.neighbourhoodLanguage, join(shared, 'neighbourhoods'));
    if (seed.agentLanguage) set(seed.agentLanguage, join(shared, 'agent-profiles'));
  }

  /** `ad4m-executor init` on a new data folder, with this world's seed and language settings. */
  async initDataFolder(dataPath: string, operator?: string): Promise<void> {
    const args = ['init', '--data-path', dataPath, '--network-bootstrap-seed', this.seedPath];
    if (operator) args.push('--operator', operator);
    const init = new Proc(`init ${dataPath}`, this.checkout.executor, args, {
      cwd: this.checkout.testsJs,
      log: join(this.logs, 'init.log'),
    });
    const { code } = await init.done();
    await init.stop();
    if (code !== 0) throw new Error(`init of ${dataPath} failed: ${init.tail(20)}`);
    this.writeLanguageSettings(dataPath);
  }

  /** Starts an executor with no admin credential, as a server a person runs on this machine. */
  async startExecutor(spec: ExecutorSpec): Promise<ExecutorHandle> {
    if (this.executors.has(spec.name)) throw new Error(`the world already has an executor ${spec.name}`);
    const dataPath = join(this.dir, 'executors', spec.name);
    mkdirSync(dataPath, { recursive: true });
    await this.initDataFolder(dataPath, spec.operator);
    const port = await freePort();
    const log = join(this.logs, `executor-${spec.name}.log`);
    const proc = new Proc(
      `executor ${spec.name}`,
      this.checkout.executor,
      [
        'run',
        '--app-data-path',
        dataPath,
        '--port',
        String(port),
        '--language-language-only',
        'false',
        '--run-dapp-server',
        'false',
        '--run-holochain',
        'false',
        '--insecure-no-admin-credential',
      ],
      {
        cwd: this.checkout.testsJs,
        log,
        env: { ...process.env, AD4M_IDENTITY_STORE_URL: this.storeUrl, AD4M_IDENTITY_STORE_KEYS: this.storeKey },
      },
    );
    this.procs.push(proc);
    const ready = [`API server starting on http://127.0.0.1:${port}/api/v1`, `listening on http://127.0.0.1:${port}`];
    await proc.waitFor((l) => ready.some((m) => l.includes(m)), 180_000, 'ready line');
    const url = `http://127.0.0.1:${port}`;
    this.endpoints.add(spec.name, url);
    const handle: ExecutorHandle = {
      name: spec.name,
      url,
      dataPath,
      log,
      proc,
      call: (type, params = {}) => rpc(url, '', type, params),
    };
    await handle.call('agent.generate', { passphrase: 'passphrase' });
    this.executors.set(spec.name, handle);
    return handle;
  }

  executor(name: string): ExecutorHandle {
    const handle = this.executors.get(name);
    if (!handle) throw new Error(`no executor ${name} in this world`);
    return handle;
  }

  /** Starts a process that belongs to the world: it stops with the world. */
  spawn(label: string, command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }): Proc {
    const proc = new Proc(label, command, args, {
      ...options,
      log: join(this.logs, `${label.replace(/[^a-z0-9-]+/gi, '-')}.log`),
    });
    this.procs.push(proc);
    return proc;
  }

  /** The folders a scan after a scenario reads: every log and data folder of the world. */
  scanPaths(): string[] {
    return [this.dir];
  }

  /** Stops every process of the world, and fails if one is still running afterwards. */
  async stop(): Promise<void> {
    await Promise.all(this.procs.map((p) => p.stop()));
    // A killed process is gone once the system has reaped it, a moment after the signal.
    const alive = () => this.procs.filter((p) => p.pid !== undefined && groupAlive(p.pid));
    for (let i = 0; i < 50 && alive().length; i++) await new Promise((r) => setTimeout(r, 100));
    const left = alive();
    if (left.length) throw new Error(`still running after the world stopped: ${left.map((p) => p.label).join(', ')}`);
  }
}
