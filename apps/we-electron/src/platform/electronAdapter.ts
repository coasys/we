import type { Ad4mClient } from '@coasys/ad4m';
import type { PlatformAdapter } from '@we/app-framework/shared';

import { buildAd4mClientWithApollo } from '../utils/apolloClient';

// Electron IPC bridge - will be exposed by preload script
declare global {
  interface Window {
    electron: {
      getPort: () => Promise<number>;
      getToken: () => Promise<string>;
      getIsDevelopment: () => Promise<boolean>;
      getDesktopSources: () => Promise<any[]>;
    };
  }
}

// Cache isDevelopment value
// Use Vite's built-in DEV flag - true in dev server, false in production build
const isDevelopmentCache: boolean = import.meta.env.DEV;

export const electronAdapter: PlatformAdapter = {
  async buildAd4mClient(): Promise<Ad4mClient> {
    // Check if electron bridge is available
    if (!window.electron) {
      throw new Error('Electron IPC bridge not available. Make sure preload script is loaded.');
    }

    // Get connection details from Electron main process via IPC
    const port = await window.electron.getPort();
    const token = await window.electron.getToken();

    // Build Apollo-based Ad4mClient
    const { client } = await buildAd4mClientWithApollo(port, token);

    return client;
  },

  async getConnectionDetails(): Promise<{ port: number; token: string }> {
    // Desktop platforms expose connection details for iframe communication
    const port = await window.electron.getPort();
    const token = await window.electron.getToken();

    return { port, token };
  },

  isDesktop: true,
  // Return the cached value determined at module load time
  get isDevelopment(): boolean {
    return isDevelopmentCache;
  },
  platform: 'electron' as const,
};
