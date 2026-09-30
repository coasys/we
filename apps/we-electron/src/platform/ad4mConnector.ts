import type { Account, BackendConnector, ExecutorSettings, ScreenSource } from '@we/app-shell/shared';
import { createLocalAd4mConnector } from '@we/backend-ad4m';

import weSeed from '../../../../we-seed.json';

// Electron IPC bridge - will be exposed by preload script
declare global {
  interface Window {
    electron: {
      getPort: () => Promise<number>;
      getToken: () => Promise<string>;
      getIsDevelopment: () => Promise<boolean>;
      getDevLinkLanguageBundle: () => Promise<string | null>;
      getDesktopSources: () => Promise<unknown[]>;
      // Choosing a screen to share where the OS will not ask — see `screenSources` on the adapter.
      onScreenSourceRequest: (listener: (sources: ScreenSource[]) => void) => () => void;
      chooseScreenSource: (id: string) => void;
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
      saveFile: (file: { name: string; type: string; bytes: Uint8Array }) => Promise<boolean>;
    };
  }
}

/** Only the transport is this platform's own: connection details come over the IPC bridge. */
export const ad4mConnector: BackendConnector = createLocalAd4mConnector(
  async () => {
    if (!window.electron) {
      throw new Error('Electron IPC bridge not available. Make sure preload script is loaded.');
    }
    return { port: await window.electron.getPort(), token: await window.electron.getToken() };
  },
  {
    linkServerUrl: (weSeed.ad4m as { linkServerUrl?: string }).linkServerUrl,
    // Null outside a development run, so a packaged app never publishes a language on its own.
    devLinkLanguageBundle: async () => (await window.electron?.getDevLinkLanguageBundle?.()) ?? null,
  },
);
