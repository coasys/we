import type { Ad4mClient } from '@coasys/ad4m';
import Ad4mConnect from '@coasys/ad4m-connect';
import type { PlatformAdapter } from '@we/app-framework/shared';

export const webAdapter: PlatformAdapter = {
  async buildAd4mClient(): Promise<Ad4mClient> {
    const connect = Ad4mConnect({
      appName: 'WE',
      appDesc: 'Social media for the new internet',
      appDomain: 'ad4m.weco.io',
      appIconPath: 'https://avatars.githubusercontent.com/u/34165012',
      capabilities: [{ with: { domain: '*', pointers: ['*'] }, can: ['*'] }],
    });

    return await connect.getAd4mClient();
  },

  // Web doesn't expose connection details (handled internally by ad4m-connect)
  // getConnectionDetails is optional, so we don't implement it

  isDesktop: false,
  platform: 'web' as const,
};
