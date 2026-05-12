import type { Ad4mClient } from '@coasys/ad4m';
import { getAd4mConnect } from '@coasys/ad4m-connect';
import type { AppConfig, PlatformAdapter } from '@we/app-framework/shared';

let ad4mCore: Awaited<ReturnType<typeof getAd4mConnect>>['core'] | null = null;

export const webAdapter: PlatformAdapter = {
  async buildAd4mClient(): Promise<Ad4mClient> {
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

  async getConnectionDetails(): Promise<{ port: number; token: string; url?: string }> {
    if (!ad4mCore?.token) throw new Error('AD4M not authenticated — call buildAd4mClient first');
    // Use baseUrl (not url) so wss:// remote-host URLs are normalized to https:// before
    // being forwarded in AD4M_CONFIG — the embedded app's startsWith('http') guard would
    // otherwise reject raw wss:// URLs and fall back to localhost.
    return { port: ad4mCore.port, token: ad4mCore.token, url: ad4mCore.baseUrl };
  },

  resolveAppUrl(app: AppConfig, isDevelopment: boolean): string {
    // Development mode: Use devServer configuration from seed
    if (isDevelopment && app.paths.devServer) {
      const host = app.paths.devServer.host || 'localhost';
      const port = app.paths.devServer.port;
      return `http://${host}:${port}`;
    }

    // Production mode: use webUrl if configured, otherwise fall back to dist path
    return app.paths.webUrl ?? app.paths.dist;
  },

  isDesktop: false,
  get isDevelopment(): boolean {
    return import.meta.env.DEV;
  },
  platform: 'web' as const,
};
