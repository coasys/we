import type { DesktopServers, ExecutorBridge } from '@we/app-coasys/hosts/desktop';
import type { Account, BackendConnector, ScreenSource, StorageStatus } from '@we/app-shell/shared';
import { type Ad4mCustodyHost, createLocalAd4mConnector } from '@we/backend-ad4m';
import weSeed from '@we/seed-file';

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
      restartExecutor: () => Promise<void>;
      chooseFile: (options: { save: boolean; defaultName?: string }) => Promise<string | null>;
      // Absent in an older main process.
      storageStatus?: () => Promise<StorageStatus | null>;
      saveFile: (file: { name: string; type: string; bytes: Uint8Array }) => Promise<boolean>;
      // The custody sidecar's window and public state; absent where there is no custody service.
      custody?: Ad4mCustodyHost;
      // The executor this app runs, for the app before a session; absent in an older main process.
      executor?: ExecutorBridge;
      // The servers the account was given and which one serves it; absent in a build without them.
      servers?: DesktopServers;
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
    /*
      The custody sidecar keeps the master key beside the executor and signs changes to the identity
      against it, so it is part of reaching this backend: the main process opens its window, runs the
      change and answers `open` with how it ended. Absent on Windows, where the identity is read-only.
    */
    custody: window.electron?.custody,
  },
);
