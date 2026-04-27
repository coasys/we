import type { Ad4mClient } from '@coasys/ad4m';
import { getAd4mClient } from '@coasys/ad4m-connect';
import type { AppConfig, PlatformAdapter } from '@we/app-framework/shared';

export const webAdapter: PlatformAdapter = {
  async buildAd4mClient(): Promise<Ad4mClient> {
    // TODO: update with new ad4m connect logic
    const client = await getAd4mClient({
      appInfo: {
        name: 'WE',
        description: 'Social media for the new internet',
        url: 'ad4m.weco.io',
        iconPath: 'https://avatars.githubusercontent.com/u/34165012',
      },
      capabilities: [{ with: { domain: '*', pointers: ['*'] }, can: ['*'] }],
    });

    return client;
  },

  async getConnectionDetails(): Promise<{ port: number; token: string }> {
    const token = localStorage.getItem('ad4m-token');
    const port = parseInt(localStorage.getItem('ad4m-port') ?? '12000');
    if (!token) throw new Error('AD4M token not found in localStorage — is ad4m-connect authenticated?');
    return { port, token };
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
