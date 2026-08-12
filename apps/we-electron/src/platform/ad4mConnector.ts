import type { Account, BackendConnector, ExecutorSettings } from '@we/app-shell/shared';
import { createLocalAd4mConnector } from '@we/backend-ad4m';

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

/** Only the transport is this platform's own: connection details come over the IPC bridge. */
export const ad4mConnector: BackendConnector = createLocalAd4mConnector(async () => {
  if (!window.electron) {
    throw new Error('Electron IPC bridge not available. Make sure preload script is loaded.');
  }
  return { port: await window.electron.getPort(), token: await window.electron.getToken() };
});
