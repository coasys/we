import type { Ad4mClient } from '@coasys/ad4m';
import { invoke } from '@tauri-apps/api/core';
import type { AppConfig, PlatformAdapter } from '@we/app-framework/shared';

import portMap from '../generated/seed-port-map.json';
import { buildAd4mClientWithApollo } from '../utils/apolloClient';

export const tauriAdapter: PlatformAdapter = {
  async buildAd4mClient(): Promise<Ad4mClient> {
    // Get connection details from Tauri backend
    const port = await invoke<number>('get_port');
    const token = await invoke<string>('request_credential');

    // Build Apollo-based Ad4mClient
    const { client } = await buildAd4mClientWithApollo(port, token);

    return client;
  },

  async getConnectionDetails(): Promise<{ port: number; token: string }> {
    // Desktop platforms expose connection details for iframe communication
    const port = await invoke<number>('get_port');
    const token = await invoke<string>('request_credential');

    return { port, token };
  },

  resolveAppUrl(app: AppConfig, isDevelopment: boolean): string {
    // Development mode: Use devServer configuration from seed
    if (isDevelopment && app.paths.devServer) {
      const host = app.paths.devServer.host || 'localhost';
      const port = app.paths.devServer.port;
      return `http://${host}:${port}`;
    }

    // Production mode: Use HTTP server ports from generated config
    // Apps are served via HTTP on localhost (similar to Electron)
    const port = portMap[app.id as keyof typeof portMap];
    if (!port) {
      console.error(`No port mapping found for app: ${app.id}`);
      return 'about:blank';
    }

    return `http://localhost:${port}`;
  },

  isDesktop: true,
  get isDevelopment(): boolean {
    return import.meta.env.DEV;
  },
  platform: 'tauri' as const,
};
