import type { Account, BackendConnector, BackendInitResult, ExecutorSettings } from '@we/app-shell/shared';
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
      // The contract's own type rather than a hand-copied shape: the copy had drifted, and was
      // missing the `hasAgent` the boot screen reads to tell setup from sign-in.
      listAccounts: () => Promise<Account[]>;
      createAccount: () => Promise<Account>;
      setAccountDisplay: (id: string, display: { name?: string; avatar?: string }) => Promise<void>;
      selectAccount: (id: string) => Promise<void>;
      removeAccount: (id: string) => Promise<void>;
      applyAccountSelection: () => Promise<void>;
      getExecutorSettings: () => Promise<ExecutorSettings>;
      setExecutorSettings: (settings: Partial<ExecutorSettings>) => Promise<ExecutorSettings>;
      restartExecutor: () => Promise<void>;
      chooseFile: (options: { save: boolean; defaultName?: string }) => Promise<string | null>;
    };
  }
}

export const ad4mConnector: BackendConnector = {
  async initialize(ctx): Promise<BackendInitResult> {
    // Check if electron bridge is available
    if (!window.electron) {
      throw new Error('Electron IPC bridge not available. Make sure preload script is loaded.');
    }

    // Get connection details from the Electron main process via IPC
    const port = await window.electron.getPort();
    const token = await window.electron.getToken();

    // The main process spawns the executor alongside the window — give it a moment to come up
    // before opening connections against it. This wait is a property of how THIS platform starts
    // its backend, which is why it lives here and not in the shell.
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const { client } = await buildAd4mClientWithApollo(port, token);

    return {
      client,
      ports: createAd4mBackendPorts(client, ctx),
      // Forwarded to hosted app iframes by the embed bridge.
      connection: { port, token },
    };
  },
};
