import type { Ad4mClient } from '@coasys/ad4m';
import { type Ad4mConnect, getAd4mConnect } from '@coasys/connect';
import type { BackendConnector, BackendInitResult } from '@we/app-shell/shared';
import { capabilitiesFromToken, createAd4mBackendPorts, holdsOperatorCredential } from '@we/backend-ad4m';
import weSeed from '@we/seed-file';

import { APP_ENDPOINTS, APP_ID } from './endpoints';

/** What a session is read from: Connect's core, or a host's boot session shaped like it. */
export type LiveSession = Pick<Ad4mConnect, 'token' | 'baseUrl' | 'port' | 'authState' | 'disconnect'>;

/**
 * The backend a connected client makes: the ports over `client`, and the connection an embedded
 * app is handed. Read from `live` where the token can change, because Connect replaces it when it
 * renews the session.
 */
export async function backendFor(
  client: Ad4mClient,
  live: LiveSession,
  ctx: Parameters<BackendConnector['initialize']>[0],
): Promise<BackendInitResult> {
  // Whether this connection operates the node it reached. A multi-user executor is one where this
  // agent is a user rather than the operator. It decides whether to offer changes that every user
  // of the node shares — "restart networking" on a shared machine being the clearest thing that
  // should not exist.
  const administersNode = !(await client.runtime.multiUserEnabled().catch(() => false));

  // What the executor actually granted this session, read from the token it granted with. Paired
  // with `administersNode` rather than replacing it: the grant says an operation is permitted, and
  // `administersNode` says it is ours to perform. Reading models is the case that needs the first
  // without the second — a hosted guest holds `AI READ`, and hiding it made a working
  // transcription model look like no model at all.
  const capabilities = capabilitiesFromToken(live.token);

  return {
    client,
    ports: createAd4mBackendPorts(client, ctx, {
      administersNode,
      // Whether the token is the executor's operator credential or a grant. The token this
      // connector holds is a grant, so it is not the operator however much it holds — and the
      // executor keeps some calls (installing local AI, for one) to the operator alone.
      operator: holdsOperatorCredential(live.token),
      capabilities,
      // The client is handed over only after the executor answered, so the first status is known.
      unlockedAtConnect: live.authState === 'authenticated',
      linkServerUrl: (weSeed.ad4m as { linkServerUrl?: string }).linkServerUrl,
      connection: () => (live.baseUrl ? { url: live.baseUrl, token: live.token } : null),
    }),
    // What "log out" means here. The agent may be on a node this app does not run and was never
    // unlocked with a password it holds, so there is no lock to close — ending the session means
    // forgetting the token, which is what `disconnect` does. The shell reloads afterwards, which
    // brings the Connect frame back.
    disconnect: () => live.disconnect(),
    // Use baseUrl (not url) so wss:// remote-host URLs are normalized to https:// before
    // being forwarded in AD4M_CONFIG — the embedded app's startsWith('http') guard would
    // otherwise reject raw wss:// URLs and fall back to localhost.
    ...(live.token ? { connection: { port: live.port, token: live.token, url: live.baseUrl } } : {}),
  };
}

export const ad4mConnector: BackendConnector = {
  async initialize(ctx): Promise<BackendInitResult> {
    // `getAd4mConnect` is the advanced API: `core` comes back immediately, so listeners can be
    // attached before the user has finished authenticating, and the client comes back as a promise
    // that settles when they have.
    //
    // Both halves have to be awaited before anything is built over them. Passing the *promise* on
    // as the client is what made every port an object whose `.agent` and `.runtime` were undefined,
    // and reading `core.token` before the connection existed dropped the port/token/url that
    // embedded apps are handed. The first symptom was the whole app stopping on the boot screen
    // with no message, because the resulting TypeError landed in the session's own catch.
    const { core, client: connecting } = getAd4mConnect({
      // The platform registry knows the app by this id and lists the origins it may run on; the
      // frame on the auth domain refuses any other page.
      appId: APP_ID,
      endpoints: {
        authDomain: APP_ENDPOINTS.identityOrigin,
        platform: APP_ENDPOINTS.apiOrigin,
        store: APP_ENDPOINTS.storeOrigin,
      },
      capabilities: [{ with: { domain: '*', pointers: ['*'] }, can: ['*'] }],
    });

    // Resolves when the person has chosen one of their devices in Connect's frame and the frame has
    // answered — the frame is up until then, so this is where a web boot waits.
    return backendFor(await connecting, core, ctx);
  },
};
