import type { Ad4mClient } from '@coasys/ad4m';
import type { PlatformAdapter } from '@we/app-framework/shared';

import { buildAd4mClientWithApollo } from '../utils/apolloClient';

// Electron IPC bridge - will be exposed by preload script
declare global {
  interface Window {
    electron: {
      getPort: () => Promise<number>;
      getToken: () => Promise<string>;
    };
  }
}

export const electronAdapter: PlatformAdapter = {
  async buildAd4mClient(): Promise<Ad4mClient> {
    console.log('Electron adapter: buildAd4mClient called');

    // Check if electron bridge is available
    if (!window.electron) {
      throw new Error('Electron IPC bridge not available. Make sure preload script is loaded.');
    }

    console.log('Electron adapter: Getting port and token via IPC...');

    // Get connection details from Electron main process via IPC
    const port = await window.electron.getPort();
    const token = await window.electron.getToken();

    console.log('Electron adapter: Got port:', port, 'token:', token?.substring(0, 8) + '...');

    // Build Apollo-based Ad4mClient
    console.log('Electron adapter: Building Apollo client...');
    const { client } = await buildAd4mClientWithApollo(port, token);

    console.log('Electron adapter: Apollo client built successfully');
    return client;
  },

  async getConnectionDetails(): Promise<{ port: number; token: string }> {
    // Desktop platforms expose connection details for iframe communication
    const port = await window.electron.getPort();
    const token = await window.electron.getToken();

    return { port, token };
  },

  isDesktop: true,
  platform: 'electron' as const,
};
