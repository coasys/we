/**
 * Starts a throwaway executor for the live tests, and stops it afterwards.
 *
 * Both live files talk to the one process this starts, through the connection it provides — the
 * capability check (`capabilities.live.ts`, which is what `pnpm verify:ad4m` runs) and the shared
 * conformance suite. An executor takes far longer to start than a test takes to run, and each file
 * works in perspectives of its own.
 *
 * The executor is isolated from anything else on the machine on purpose: a fresh data directory in
 * the temp dir, free ports for the API and for Holochain (whose defaults a desktop executor already
 * running would hold), and no bootstrap, proxy or mDNS, so it never joins a network. One node, no
 * peers — which is all the cases ask about.
 *
 * Which binary: the one `scripts/ad4m-executor.mjs` chooses — `AD4M_EXECUTOR`, else the seed's own
 * `ad4m.executorPath`, else the pinned commit's download (`pnpm ad4m:executor`). To run against an
 * executor that is already running instead, set `AD4M_LIVE_URL` and `AD4M_LIVE_TOKEN` — its agent
 * unlocked — and know that the tests then write their perspectives into that agent.
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Ad4mClient } from '@coasys/ad4m';
import type { TestProject } from 'vitest/node';

export interface LiveExecutor {
  url: string;
  token: string;
  /**
   * The executor's MCP endpoint (`http://…/mcp`), which is how a bot reaches the tools a waker is
   * configured from (`get_mention_waker_config`). Absent for an executor already running
   * (`AD4M_LIVE_URL`) unless `AD4M_LIVE_MCP_URL` names it.
   */
  mcpUrl?: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    ad4mExecutor: LiveExecutor;
  }
}

const PASSPHRASE = 'we-live';

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });
}

function executorBinary(): string {
  // packages/backend-system/ad4m/tests/live → the repo root.
  const script = resolve(import.meta.dirname, '../../../../../scripts/ad4m-executor.mjs');
  const chosen = spawnSync(process.execPath, [script, '--path'], { encoding: 'utf8' });
  if (chosen.status !== 0) throw new Error(`Could not work out which executor to run:\n${chosen.stderr}`);
  const binary = chosen.stdout.trim();
  if (existsSync(binary)) return binary;
  throw new Error(
    `No executor at ${binary}. Run \`pnpm ad4m:executor\` to download the pinned one, or set ` +
      'AD4M_EXECUTOR to an ad4m-executor binary.',
  );
}

/** Rejects after `ms` — a call whose socket failed to open neither resolves nor rejects. */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, fail) => setTimeout(() => fail(new Error(`no answer in ${ms}ms`)), ms)),
  ]);
}

/**
 * Ready means the API answers, not that the port is open — the RPC server comes up last.
 *
 * A fresh client per attempt, each given a few seconds: a client whose first socket was refused
 * never recovers, and its calls hang rather than fail, so retrying on it waits forever.
 */
async function waitUntilAnswering(url: string, token: string, exited: () => string | null): Promise<Ad4mClient> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const reason = exited();
    if (reason) throw new Error(`The executor exited before it was ready: ${reason}`);
    const client = new Ad4mClient(url, token);
    try {
      await within(client.agent.status(), 3_000);
      return client;
    } catch {
      client.close();
      if (Date.now() > deadline) throw new Error('The executor did not answer within two minutes.');
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
}

/** A fresh executor has no agent. One already running has somebody's, whose passphrase is not ours. */
async function ensureUnlockedAgent(client: Ad4mClient): Promise<void> {
  const status = await client.agent.status();
  if (!status.isInitialized) await client.agent.generate(PASSPHRASE);
  else if (!status.isUnlocked)
    throw new Error('The agent is locked. Unlock it, or let the tests start their own executor.');
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const presetUrl = process.env.AD4M_LIVE_URL;
  if (presetUrl) {
    const token = process.env.AD4M_LIVE_TOKEN ?? '';
    const client = new Ad4mClient(presetUrl, token);
    await ensureUnlockedAgent(client);
    client.close();
    project.provide('ad4mExecutor', { url: presetUrl, token, mcpUrl: process.env.AD4M_LIVE_MCP_URL });
    return async () => {};
  }

  const binary = executorBinary();
  const dataPath = mkdtempSync(join(tmpdir(), 'we-ad4m-live-'));
  const [port, hcAdminPort, hcAppPort, mcpPort] = [
    await freePort(),
    await freePort(),
    await freePort(),
    await freePort(),
  ];
  const token = randomUUID();
  const output: string[] = [];

  const init = spawnSync(binary, ['init', '--data-path', dataPath], { encoding: 'utf8' });
  if (init.status !== 0) throw new Error(`ad4m-executor init failed: ${init.stderr || init.error}`);

  const executor: ChildProcess = spawn(
    binary,
    [
      'run',
      '--app-data-path',
      dataPath,
      '--port',
      String(port),
      '--admin-credential',
      token,
      '--hc-admin-port',
      String(hcAdminPort),
      '--hc-app-port',
      String(hcAppPort),
      '--hc-use-bootstrap',
      'false',
      '--hc-use-proxy',
      'false',
      '--hc-use-local-proxy',
      'false',
      '--hc-use-mdns',
      'false',
      '--run-dapp-server',
      'false',
      '--enable-mcp',
      'true',
      '--mcp-port',
      String(mcpPort),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  // Kept, not printed: it is only worth reading when something went wrong, and then all of it is.
  executor.stdout?.on('data', (chunk) => output.push(String(chunk)));
  executor.stderr?.on('data', (chunk) => output.push(String(chunk)));
  let exit: string | null = null;
  const exited = new Promise<void>((done) =>
    executor.on('exit', (code, signal) => {
      exit = `code ${code}, signal ${signal}`;
      done();
    }),
  );

  // An interrupted run skips teardown, and the executor outlives it holding its ports — so it goes
  // when this process does, however that happens.
  const orphanGuard = () => executor.kill('SIGKILL');
  process.once('exit', orphanGuard);

  const stop = async () => {
    process.off('exit', orphanGuard);
    if (exit === null) {
      // It does not always honour SIGTERM, hence the escalation.
      executor.kill('SIGTERM');
      await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
      if (exit === null) executor.kill('SIGKILL');
      await exited;
    }
    // Only once it has gone: it writes while shutting down, and a directory removed before that is
    // recreated behind it.
    rmSync(dataPath, { recursive: true, force: true });
  };

  const url = `http://127.0.0.1:${port}`;
  try {
    // Closed once the agent exists: an open socket would keep the run alive after the last test.
    const client = await waitUntilAnswering(url, token, () => exit);
    await within(ensureUnlockedAgent(client), 60_000);
    client.close();
  } catch (error) {
    await stop();
    throw new Error(`${(error as Error).message}\n--- executor output ---\n${output.join('').slice(-8_000)}`);
  }

  project.provide('ad4mExecutor', { url, token, mcpUrl: `http://127.0.0.1:${mcpPort}/mcp` });
  return stop;
}
