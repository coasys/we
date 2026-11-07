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
import type { Ad4mCustodyHost, Ad4mServerHost, Ad4mServing } from './identityPort';
import { type ConnectRemote, type KeySession, type KeySessionSigner, openKeySession } from './keySession';
import type { Ad4mLifecycleOptions } from './lifecycleAdapter';

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
): Promise<{ client: Ad4mClient; status: AgentStatus }> {
  const baseUrl = `http://localhost:${port}`;
  const ad4mClient = new Ad4mClient(baseUrl, token);
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
 *
 * Where the host keeps a list of the person's servers (`servers`) and one is chosen, the app is served
 * from that server instead: this computer's executor still comes up first, because it holds the
 * device key that signs the login there (see `keySession.ts`). A server that will not let this
 * computer in leaves the app on this computer, with the reason in the identity port's `serving()`.
 */
export function createLocalAd4mConnector(
  getConnection: () => Promise<LocalExecutorConnection>,
  options: {
    startupDelayMs?: number;
    /** The host's custody service, where it runs one beside the executor. See `identityPort.ts`. */
    custody?: Ad4mCustodyHost;
    /** The servers this account can be served by, where the host keeps them. See `identityPort.ts`. */
    servers?: Ad4mServerHost;
    /** How a client on a server is opened; the SDK's, outside tests. */
    connectRemote?: ConnectRemote;
    /** How this computer's executor is reached once its port is known; the SDK's, outside tests. */
    connectLocal?: (port: number, token: string) => Promise<{ client: unknown }>;
  } & Ad4mLifecycleOptions = {},
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

      const { client } = await (options.connectLocal ?? connectToLocalExecutor)(port, token);
      const local = { url: `http://localhost:${port}`, token };
      const shared = {
        linkServerUrl: options.linkServerUrl,
        devLinkLanguageBundle: options.devLinkLanguageBundle,
        custody: options.custody,
      };

      const served = options.servers ? await serveFromChosen(client, options.servers, options.connectRemote) : null;
      if (!served?.current) {
        return {
          client,
          ports: createAd4mBackendPorts(client, ctx, {
            ...shared,
            connection: () => local,
            ...(served ? { serving: served } : {}),
          }),
          // Forwarded to hosted app iframes by the embed bridge.
          connection: { port, token },
        };
      }

      const { session, name } = served.current;
      const remote = new URL(session.address);
      return {
        client: session.client,
        ports: createAd4mBackendPorts(session.client, ctx, {
          ...shared,
          connection: () => ({ url: session.address, token: session.token() }),
          serving: served,
          identityClient: client,
          // The server's own settings are for the person who runs it; an agent it serves gets none.
          administersNode: session.role === 'operator',
          onThisMachine: false,
        }),
        connection: {
          port: Number(remote.port) || (remote.protocol === 'https:' ? 443 : 80),
          token: session.token(),
          url: session.address,
        },
        host: { id: session.address, name, url: session.address },
      };
    },
  };
}

/**
 * Logs in to the server the person chose, if they chose one. Never throws: a server that cannot be
 * reached or refuses this computer leaves the session here, with why.
 */
async function serveFromChosen(signer: unknown, host: Ad4mServerHost, connect?: ConnectRemote): Promise<Ad4mServing> {
  const keySigner = signer as KeySessionSigner;
  let chosen: { address: string; name: string } | undefined;
  try {
    const { servers, serving } = await host.list();
    chosen = serving ? servers.find((server) => server.address === serving) : undefined;
  } catch (error) {
    return {
      host,
      signer: keySigner,
      current: null,
      problem: `Could not read your servers: ${String(error)}`,
      connect,
    };
  }
  if (!chosen) return { host, signer: keySigner, current: null, problem: null, connect };

  let session: KeySession;
  try {
    session = await openKeySession(keySigner, chosen.address, connect ? { connect } : {});
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return { host, signer: keySigner, current: null, problem: `${chosen.name} is not serving you: ${why}`, connect };
  }
  return { host, signer: keySigner, current: { session, name: chosen.name }, problem: null, connect };
}
