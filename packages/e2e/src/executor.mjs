/**
 * A throwaway ad4m executor, and accounts on it.
 *
 * Multi-user by default, as a hosted node runs: the main agent is made at start (it signs every
 * user's token), people sign up and log in through the client with no email step, and the admin
 * credential acts as the node's operator — the one that registers a model or grants free access.
 *
 * Isolated from anything else on the machine on purpose: a fresh data directory in the temp dir,
 * free ports for the API and for Holochain (whose defaults a desktop executor already running would
 * hold), and no bootstrap, proxy or mDNS, so it never joins a network.
 *
 * The data directory's prefix is `we-live-web-` and must stay so: ad4m's own CI runs WE's journeys,
 * cleans `/tmp/we-live-web-*` afterwards, and finds an executor left running by that path.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Ad4mClient } from '@coasys/ad4m';

import { executorBinary } from './env.mjs';
import { sleep, within } from './waits.mjs';

export { sleep };

/** The prefix of every data directory this starts. See the header. */
export const DATA_PREFIX = 'we-live-web-';

/** A TCP port free on 127.0.0.1 a moment ago. */
export function freePort() {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

/**
 * Starts an executor and resolves once its API answers and its main agent exists.
 *
 * - `multiUser` — a hosted node's mode (default). `false` runs one agent, as a desktop does.
 * - `mcp` — also serve the MCP endpoint, at the returned `mcpUrl`.
 * - `env` — added to the executor's environment.
 * - `binary` — the executor to run; default the one `scripts/ad4m-executor.mjs` chooses.
 * - `passphrase` — the main agent's.
 * - `logFile` — where its output is written when it stops; default `WE_LIVE_LOG`, else nowhere.
 */
export async function startExecutor({
  multiUser = true,
  mcp = false,
  env = {},
  binary = executorBinary(),
  passphrase = 'we-live',
  readyTimeout = 120_000,
  logFile = process.env.WE_LIVE_LOG,
} = {}) {
  const dataPath = mkdtempSync(join(tmpdir(), DATA_PREFIX));
  const [port, hcAdminPort, hcAppPort] = [await freePort(), await freePort(), await freePort()];
  const mcpPort = mcp ? await freePort() : null;
  const adminCredential = randomUUID();
  // Kept, not printed: it is only worth reading when something went wrong, and then all of it is.
  const output = [];

  const init = spawnSync(binary, ['init', '--data-path', dataPath], { encoding: 'utf8' });
  if (init.status !== 0) {
    rmSync(dataPath, { recursive: true, force: true });
    throw new Error(`ad4m-executor init failed: ${init.stderr || init.error}`);
  }

  // prettier-ignore
  const child = spawn(binary, [
    'run', '--app-data-path', dataPath, '--port', String(port),
    '--admin-credential', adminCredential,
    ...(multiUser ? ['--enable-multi-user', 'true'] : []),
    '--hc-admin-port', String(hcAdminPort), '--hc-app-port', String(hcAppPort),
    '--hc-use-bootstrap', 'false', '--hc-use-proxy', 'false', '--hc-use-local-proxy', 'false',
    '--hc-use-mdns', 'false', '--run-dapp-server', 'false',
    ...(mcpPort ? ['--enable-mcp', 'true', '--mcp-port', String(mcpPort)] : []),
  ], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  child.stderr.on('data', (chunk) => output.push(String(chunk)));
  let exit = null;
  const exited = new Promise((done) =>
    child.on('exit', (code, signal) => {
      exit = `code ${code}, signal ${signal}`;
      done();
    }),
  );
  // An interrupted run skips teardown, and the executor outlives it holding its ports — so it goes
  // when this process does, however that happens.
  const orphanGuard = () => child.kill('SIGKILL');
  process.once('exit', orphanGuard);

  const url = `http://127.0.0.1:${port}`;
  const log = () => output.join('');
  let admin;
  let stopped = null;
  const stop = () =>
    (stopped ??= (async () => {
      process.off('exit', orphanGuard);
      // The admin client reconnects its socket for ever once the executor has gone, which would keep
      // the test process alive after the last test.
      admin?.close?.();
      if (exit === null) {
        // It does not always honour SIGTERM, hence the escalation.
        child.kill('SIGTERM');
        await Promise.race([exited, sleep(10_000)]);
        if (exit === null) child.kill('SIGKILL');
        await exited;
      }
      if (logFile) writeFileSync(logFile, log());
      // Only once it has gone: it writes while shutting down, and a directory removed before that is
      // recreated behind it.
      rmSync(dataPath, { recursive: true, force: true });
    })());

  try {
    // Ready means the API answers, not that the port is open: the RPC server comes up last. A fresh
    // client per attempt, each given a few seconds: a client whose first socket was refused never
    // recovers, and its calls hang rather than fail, so retrying on it waits forever.
    const deadline = Date.now() + readyTimeout;
    for (;;) {
      if (exit) throw new Error(`The executor exited before it was ready: ${exit}`);
      const client = new Ad4mClient(url, adminCredential);
      try {
        await within(client.agent.status(), 3_000, 'agent.status');
        admin = client;
        break;
      } catch {
        client.close?.();
        if (Date.now() > deadline) throw new Error(`The executor did not answer within ${readyTimeout / 1_000} s.`);
        await sleep(1_000);
      }
    }
    const status = await admin.agent.status();
    if (!status.isInitialized) await within(admin.agent.generate(passphrase), 120_000, 'agent.generate');
    const mcpUrl = mcpPort ? `http://127.0.0.1:${mcpPort}/mcp` : undefined;
    return { url, adminCredential, admin, mcpUrl, multiUser, dataPath, output, log, stop };
  } catch (error) {
    await stop();
    throw new Error(`${error.message}\n--- executor output ---\n${log().slice(-8_000)}`);
  }
}

/**
 * An account on a multi-user executor, signed in: what ad4m-connect's email and password screen ends
 * with. No email is sent, and none is needed: the admin client grants the account free access.
 */
export async function signUp(executor, email, password = 'test123') {
  await within(executor.admin.agent.createUser(email, password), 120_000, 'agent.createUser');
  await executor.admin.runtime.setUserFreeAccess?.(email, true);
  const token = await within(executor.admin.agent.loginUser(email, password), 60_000, 'agent.loginUser');
  const client = new Ad4mClient(executor.url, token);
  const { did } = await within(client.agent.me(), 60_000, 'agent.me');
  return { email, password, token, did, client };
}

/**
 * Registers a model server as an endpoint, then one model on it, and makes that model the executor's
 * default of its type. The executor knows a model only as a model on an endpoint (ad4m #1616): the
 * endpoint holds the URL, the key and what it can do; the model names the endpoint and the id the
 * server knows it by. Needs the admin client: endpoints and defaults are the executor's, not one
 * account's.
 *
 * `capabilities` are given, not probed, so a server that is not up yet still registers as what it
 * is. With no `apiKey`, no key is sent: the executor refuses a key over plain HTTP to another host.
 * Resolves with the model's id.
 */
export async function registerModel(admin, { name, kind, capabilities, modelType, baseUrl, apiKey, model }) {
  const endpoint = await within(
    admin.ai.addEndpoint({ name, kind, baseUrl, capabilities, ...(apiKey ? { apiKey } : {}) }),
    60_000,
    'ai.addEndpoint',
  );
  const id = await within(
    admin.ai.addModel({ name, modelType, endpointId: endpoint.id, remoteModel: model }),
    60_000,
    'ai.addModel',
  );
  await within(admin.ai.setDefaultModel(modelType, id), 30_000, 'ai.setDefaultModel');
  return id;
}

/**
 * Makes a model on an OpenAI-compatible server (`/v1/chat/completions`) the executor's default
 * language model: the one that call extraction runs on. Resolves with the model's id.
 */
export function registerLlm(admin, { name = 'we-live-llm', baseUrl, apiKey, model }) {
  return registerModel(admin, {
    name,
    kind: 'OPEN_AI_COMPATIBLE',
    capabilities: ['chat'],
    modelType: 'LLM',
    baseUrl,
    apiKey,
    model,
  });
}

/**
 * Makes a model on an OpenAI-compatible speech server (`/v1/audio/transcriptions`: speaches, a
 * Whisper or Parakeet wrapper, OpenAI) the executor's default transcription model: the one that
 * writes a call's transcript. Resolves with the model's id.
 */
export function registerTranscriber(admin, { name = 'we-live-transcriber', baseUrl, apiKey, model }) {
  return registerModel(admin, {
    name,
    kind: 'OPEN_AI_AUDIO',
    capabilities: ['transcription'],
    modelType: 'TRANSCRIPTION',
    baseUrl,
    apiKey,
    model,
  });
}
