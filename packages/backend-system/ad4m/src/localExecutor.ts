/**
 * Connecting to a locally spawned executor — the choreography both desktop
 * hosts perform. Electron reaches its main process over IPC and Tauri invokes
 * a Rust command, but everything after "give me the port and token" was
 * copy-pasted between them (down to a file still named after Apollo, a client
 * library neither had used for years). The transport is the only genuinely
 * per-platform part, so it is the only part the hosts still own.
 */
import { Ad4mClient, type AgentStatus } from '@coasys/ad4m';
import type { BackendPortsContext } from '@we/backend-shared';

import { createAd4mBackendPorts } from './backendPortsAdapter';

/** Poll the executor until it answers — it is spawned alongside the window and needs a moment. */
async function ensureExecutorReady(client: Ad4mClient): Promise<{ status: AgentStatus }> {
  const maxAttempts = 30;
  const delay = 500;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const status = await client.agent.status();
      return { status };
    } catch {
      // Retrying a backend that has not come up is operational news, not a debugging leftover:
      // it is the only thing on screen while a desktop launch stalls.
      console.info(`Ad4m: Executor not ready, attempt ${attempt} of ${maxAttempts}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error(`Executor did not become ready after ${maxAttempts} attempts`);
}

/** Build an Ad4mClient against the local executor and wait for it to be ready. */
export async function connectToLocalExecutor(
  port: number,
  token: string,
  subscribe = true,
): Promise<{ client: Ad4mClient; status: AgentStatus }> {
  const baseUrl = `http://localhost:${port}`;
  const ad4mClient = new Ad4mClient(baseUrl, token, subscribe);
  const { status } = await ensureExecutorReady(ad4mClient);
  return { client: ad4mClient, status };
}

export interface LocalExecutorConnection {
  port: number;
  token: string;
}

/**
 * The full desktop connector: fetch connection details through the host's
 * transport, wait out the executor's startup, connect, and build the ports.
 * Returns the shape the shell's `BackendConnector.initialize` expects
 * (structurally — this package deliberately doesn't import the shell).
 */
export function createLocalAd4mConnector(
  getConnection: () => Promise<LocalExecutorConnection>,
  options: { startupDelayMs?: number } = {},
) {
  return {
    async initialize(ctx: BackendPortsContext) {
      const { port, token } = await getConnection();

      // The host process spawns the executor alongside the window — give it a
      // moment to come up before opening connections against it. A property of
      // how the desktop platforms start their backend, which is why it lives
      // with the connector and not in the shell.
      const delay = options.startupDelayMs ?? 1000;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

      const { client } = await connectToLocalExecutor(port, token);

      return {
        client,
        ports: createAd4mBackendPorts(client, ctx),
        // Forwarded to hosted app iframes by the embed bridge.
        connection: { port, token },
      };
    },
  };
}
