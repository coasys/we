import type { Ad4mClient } from '@coasys/ad4m';
import { invoke } from '@tauri-apps/api/core';
import type { PlatformAdapter } from '@we/app-framework/shared';

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

  isDesktop: true,
  get isDevelopment(): boolean {
    return import.meta.env.DEV;
  },
  platform: 'tauri' as const,
};
