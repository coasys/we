import type { Account, BackendConnector, ScreenSource } from '@we/app-shell/shared';
import { type Ad4mCustodyHost, type Ad4mServerHost, createLocalAd4mConnector } from '@we/backend-ad4m';
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
      saveFile: (file: { name: string; type: string; bytes: Uint8Array }) => Promise<boolean>;
      // The custody sidecar's window and public state; absent where there is no custody service.
      custody?: Ad4mCustodyHost;
      // The signed-in account's servers, kept in the account registry. `choose` only records.
      servers?: Ad4mServerHost;
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
    servers: serverHost(),
  },
);

/**
 * The account's servers, from the main process. Choosing one is recorded there and takes effect by
 * starting the renderer over: every store holds the session's data, and a reload is the clean slate
 * switching accounts already relies on (see `accounts-apply` in main.js).
 */
function serverHost(): Ad4mServerHost | undefined {
  const servers = window.electron?.servers;
  if (!servers) return undefined;
  return {
    list: () => servers.list(),
    add: (server) => servers.add(server),
    remove: (address) => servers.remove(address),
    async choose(address) {
      await servers.choose(address);
      window.location.reload();
    },
  };
}
