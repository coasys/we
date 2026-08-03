import { getAd4mConnect } from '@coasys/ad4m-connect';
import type { BackendConnector, BackendInitResult } from '@we/app-shell/shared';
import { createAd4mBackendPorts } from '@we/backend-ad4m';

export const ad4mConnector: BackendConnector = {
  async initialize(ctx): Promise<BackendInitResult> {
    // TODO: update with new ad4m connect logic
    const { core, client } = getAd4mConnect({
      appInfo: {
        name: 'WE',
        description: 'Social media for the new internet',
        url: 'ad4m.weco.io',
        iconPath: 'https://avatars.githubusercontent.com/u/34165012',
      },
      hosting: true,
      capabilities: [{ with: { domain: '*', pointers: ['*'] }, can: ['*'] }],
    });

    return {
      client,
      ports: createAd4mBackendPorts(client, ctx),
      // Use baseUrl (not url) so wss:// remote-host URLs are normalized to https:// before
      // being forwarded in AD4M_CONFIG — the embedded app's startsWith('http') guard would
      // otherwise reject raw wss:// URLs and fall back to localhost.
      ...(core.token ? { connection: { port: core.port, token: core.token, url: core.baseUrl } } : {}),
    };
  },
};
