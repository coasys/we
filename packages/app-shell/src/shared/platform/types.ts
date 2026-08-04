export interface AppConfig {
  id: string;
  name: string;
  paths: {
    projectRoot: string;
    dist: string;
    devServer?: {
      port: number;
      host?: string;
    };
    webUrl?: string;
  };
}

/**
 * One local account: a directory holding one agent's keys and data.
 *
 * Internally an account is the *container* and an agent is the identity (a DID) inside it — they
 * are not the same thing, since an account exists before any agent has been created in it, which
 * is exactly the state first-run setup passes through.
 *
 * **The UI never exposes that split.** To a user, an account is the thing they sign in to, full
 * stop; making them hold "create an account, then set up its agent" is two words for one act.
 * User-facing copy says "account" throughout, and "agent" is reserved for AD4M protocol objects
 * that genuinely are agents rather than accounts — a peer's DID in the trusted-agents list.
 */
export interface Account {
  /** The data directory. Stable, and unique by construction — no separate id to keep in sync. */
  id: string;
  name: string;
  /** The account this app instance is currently running against. */
  active: boolean;
}

/**
 * Switching which account the app runs as.
 *
 * A host capability, not a backend one: it manipulates directories on disk and relaunches the
 * process. No amount of talking to a running executor achieves it, because the executor is
 * configured with one data path at startup and holds it for its lifetime — which is why every
 * mutation here ends with the caller invoking {@link restart}.
 *
 * Optional on {@link PlatformAdapter}. The web host omits it: a browser tab has no filesystem to
 * keep accounts in and nothing to relaunch, and `ad4m-connect` already owns which executor it
 * talks to.
 */
export interface AccountHost {
  list(): Promise<Account[]>;
  /**
   * Register a new account and make it active. Creates the directory but no agent — the agent is
   * created on the next boot, by the setup screen, in the same empty directory a genuine first run
   * would see. Caller restarts to get there.
   *
   * Takes no name: the setup screen asks for one *after* the restart, so that first run and
   * adding an account reach the same single page rather than collecting the name in two different
   * places. The host assigns a provisional name until then.
   */
  create(): Promise<Account>;
  /**
   * Rename an account. How the setup screen commits the name the user chose — including on a
   * genuine first run, where the account was seeded rather than created.
   */
  rename(id: string, name: string): Promise<void>;
  select(id: string): Promise<void>;
  /**
   * Forget an account. Refuses the active one — you cannot pull the directory out from under the
   * running executor. Whether the data is erased is the host's call: an account WE created is
   * removed with its directory, one it merely adopted (a pre-existing `~/.ad4m`, shared with the
   * ADAM launcher) is only forgotten. Deleting data another app owns is not ours to do.
   */
  remove(id: string): Promise<void>;
  /** Relaunch, so the executor comes up against whichever account is now selected. */
  restart(): Promise<void>;
}

/**
 * Where the host is running, and what that implies for locating things.
 *
 * Deliberately knows nothing about the data layer — obtaining a client is `BackendConnector`'s job
 * (`shared/backend/types.ts`). The two were one interface until they proved to vary independently:
 * `resolveAppUrl` differs per platform, `connect()` differs per data layer, and a host picks each
 * without reference to the other. The practical symptom was that this file imported `@coasys/ad4m`
 * purely for a return type, so every host that wanted `isDesktop` also named the data layer.
 */
export interface PlatformAdapter {
  // Resolve app URL for iframes (platform-specific)
  // - Dev mode: Returns devServer URL (http://localhost:PORT)
  // - Production: Platform-specific resolution
  //   - Electron: Returns Express server URL (http://localhost:AUTO_PORT)
  //   - Tauri: Returns asset protocol URL (asset://localhost/...)
  //   - Web: Returns external URL or bundled path
  resolveAppUrl(app: AppConfig, isDevelopment: boolean): string;

  // Check if running in desktop app (vs web)
  isDesktop: boolean;

  // Check if running in development mode
  isDevelopment: boolean;

  // Platform identifier
  platform: 'web' | 'electron' | 'tauri';

  /**
   * Local account management, when the host can offer it. Absent on web — the boot screen
   * feature-detects and simply shows no account controls.
   */
  accounts?: AccountHost;
}
