import type { Ad4mClient } from '@coasys/ad4m';
import type { BackendConnectionDetails, BackendConnector } from '@we/app-shell/shared';
import { createAd4mBackendPorts } from '@we/backend-ad4m';

import { buildAd4mClientWithApollo } from '../utils/apolloClient';

// Electron IPC bridge - will be exposed by preload script
declare global {
  interface Window {
    electron: {
      getPort: () => Promise<number>;
      getToken: () => Promise<string>;
      getIsDevelopment: () => Promise<boolean>;
      getDesktopSources: () => Promise<unknown[]>;
    };
  }
}

export const ad4mConnector: BackendConnector = {
  async connect(): Promise<Ad4mClient> {
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

  // The connector is where the app chooses its backend: hand the shell the complete AD4M bundle.
  ports: createAd4mBackendPorts,

  async connectionDetails(): Promise<BackendConnectionDetails> {
    // Desktop platforms expose connection details for iframe communication
    const port = await window.electron.getPort();
    const token = await window.electron.getToken();

    return { port, token };
  },
};
