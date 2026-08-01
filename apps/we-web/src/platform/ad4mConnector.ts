import type { Ad4mClient } from '@coasys/ad4m';
import { getAd4mConnect } from '@coasys/ad4m-connect';
import type { BackendConnectionDetails, BackendConnector } from '@we/app-framework/shared';

let ad4mCore: Awaited<ReturnType<typeof getAd4mConnect>>['core'] | null = null;

export const ad4mConnector: BackendConnector = {
  async connect(): Promise<Ad4mClient> {
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
    ad4mCore = core;
    return client;
  },

  async connectionDetails(): Promise<BackendConnectionDetails> {
    if (!ad4mCore?.token) throw new Error('AD4M not authenticated — call connect() first');
    // Use baseUrl (not url) so wss:// remote-host URLs are normalized to https:// before
    // being forwarded in AD4M_CONFIG — the embedded app's startsWith('http') guard would
    // otherwise reject raw wss:// URLs and fall back to localhost.
    return { port: ad4mCore.port, token: ad4mCore.token, url: ad4mCore.baseUrl };
  },
};
