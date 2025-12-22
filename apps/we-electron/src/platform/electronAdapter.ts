import type { Ad4mClient } from '@coasys/ad4m';
import type { PlatformAdapter, AppConfig } from '@we/app-framework/shared';

import { buildAd4mClientWithApollo } from '../utils/apolloClient';
// Import auto-generated port mapping
import portMap from '../../electron/seed-port-map.json';

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

  resolveAppUrl(app: AppConfig, isDevelopment: boolean): string {
    // Development mode: Use devServer configuration from seed
    if (isDevelopment && app.paths.devServer) {
      const host = app.paths.devServer.host || 'localhost';
      const port = app.paths.devServer.port;
      return `http://${host}:${port}`;
    }

    // Production mode: Use Express server on localhost with auto-generated port mapping
    const port = portMap[app.id as keyof typeof portMap];
    
    if (!port) {
      console.error(`No port mapping found for app: ${app.id}`);
      return 'about:blank';
    }

    return `http://localhost:${port}`;
  },

  isDesktop: true,
  // Return the cached value determined at module load time
  get isDevelopment(): boolean {
    return isDevelopmentCache;
  },
  platform: 'electron' as const,
};


