import type { Ad4mClient } from '@coasys/ad4m';

export { sleep } from './waits.mjs';

/** The prefix of every data directory `startExecutor` makes in the temp dir. */
export const DATA_PREFIX: 'we-live-web-';

/** A TCP port free on 127.0.0.1 a moment ago. */
export function freePort(): Promise<number>;

export interface StartExecutorOptions {
  /** A hosted node's mode (default `true`); `false` runs one agent, as a desktop does. */
  multiUser?: boolean;
  /** Also serve the MCP endpoint (default `false`). */
  mcp?: boolean;
  /** Added to the executor's environment. */
  env?: Record<string, string>;
  /** The executor to run; default the one `scripts/ad4m-executor.mjs` chooses. */
  binary?: string;
  /** The main agent's passphrase. */
  passphrase?: string;
  /** How long to wait for the API to answer, in ms. Default two minutes. */
  readyTimeout?: number;
  /** Where the executor's output is written when it stops; default `WE_LIVE_LOG`. */
  logFile?: string;
}

export interface Executor {
  /** `http://127.0.0.1:<port>`. */
  url: string;
  /** The admin credential: in multi-user mode, the node's operator. */
  adminCredential: string;
  /** A client signed in with the admin credential. Closed by `stop`. */
  admin: Ad4mClient;
  /** `http://127.0.0.1:<port>/mcp` when started with `mcp`. */
  mcpUrl?: string;
  multiUser: boolean;
  dataPath: string;
  /** Everything the executor has written to stdout and stderr, in chunks, as it arrives. */
  output: string[];
  /** `output`, joined. */
  log(): string;
  /** Stops it (SIGTERM, then SIGKILL after ten seconds) and removes its data. Idempotent. */
  stop(): Promise<void>;
}

export function startExecutor(options?: StartExecutorOptions): Promise<Executor>;

export interface Account {
  email: string;
  password: string;
  token: string;
  did: string;
  client: Ad4mClient;
}

/** An account on a multi-user executor, signed in. */
export function signUp(executor: Pick<Executor, 'admin' | 'url'>, email: string, password?: string): Promise<Account>;

/** Makes an OpenAI-compatible endpoint the executor's default LLM; resolves with the model's id. */
export function registerLlm(
  admin: Ad4mClient,
  options: { name?: string; baseUrl: string; apiKey?: string; model: string },
): Promise<string>;
