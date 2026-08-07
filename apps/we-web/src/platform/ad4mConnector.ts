import { getAd4mConnect } from '@coasys/ad4m-connect';
import type { BackendConnector, BackendInitResult } from '@we/app-shell/shared';
import { createAd4mBackendPorts } from '@we/backend-ad4m';

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
      appInfo: {
        name: 'WE',
        description: 'Social media for the new internet',
        url: 'ad4m.weco.io',
        iconPath: 'https://avatars.githubusercontent.com/u/34165012',
      },
      hosting: true,
      capabilities: [{ with: { domain: '*', pointers: ['*'] }, can: ['*'] }],
    });

    // Resolves when the user has connected and authorised WE — the connect UI is up until then, so
    // this is where a web boot waits.
    const client = await connecting;

    // Whether this connection operates the node it reached, which decides how much of the settings
    // page exists. A host chosen from the connect UI is somebody else's by definition; a multi-user
    // executor is one where this agent is a user rather than the operator. Either way, trust, peer
    // networking, languages and AI models belong to whoever runs the node, and offering them here
    // produces controls that fail — "restart networking" on a shared machine most of all.
    //
    // Short-circuits, so the extra round trip only happens for a connection that might be local.
    const administersNode = !core.connectedHost && !(await core.isMultiUser());

    return {
      client,
      ports: createAd4mBackendPorts(client, ctx, { administersNode }),
      // What "log out" means here. The agent may be on a node this app does not run and was never
      // unlocked with a password it holds, so there is no lock to close — ending the session means
      // forgetting the token and the chosen host, which is what `core.disconnect` does. The shell
      // reloads afterwards, which brings the connect UI back.
      disconnect: () => core.disconnect(),
      // Use baseUrl (not url) so wss:// remote-host URLs are normalized to https:// before
      // being forwarded in AD4M_CONFIG — the embedded app's startsWith('http') guard would
      // otherwise reject raw wss:// URLs and fall back to localhost.
      ...(core.token ? { connection: { port: core.port, token: core.token, url: core.baseUrl } } : {}),
    };
  },
};
