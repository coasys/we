import type {
  Account,
  AccountHost,
  AppConfig,
  ExecutorHost,
  ExecutorSettings,
  PlatformAdapter,
} from '@we/app-shell/shared';

// Import auto-generated port mapping
import portMap from '../../electron/seed-port-map.json';

// Cache isDevelopment value
// Use Vite's built-in DEV flag - true in dev server, false in production build
const isDevelopmentCache: boolean = import.meta.env.DEV;

/**
 * The registry lives in the main process — it has to, because the data path is needed to spawn the
 * executor before any renderer exists. This is the IPC surface over it.
 */
const accounts: AccountHost = {
  list: () => window.electron.listAccounts(),
  create: () => window.electron.createAccount() as Promise<Account>,
  setDisplay: (id: string, display: { name?: string; avatar?: string }) =>
    window.electron.setAccountDisplay(id, display),
  select: (id: string) => window.electron.selectAccount(id),
  remove: (id: string) => window.electron.removeAccount(id),
  applySelection: () => window.electron.applyAccountSelection(),
};

/** The executor is a child process here, so restarting it leaves the window in place. */
const executor: ExecutorHost = {
  getSettings: () => window.electron.getExecutorSettings(),
  setSettings: (settings: Partial<ExecutorSettings>) => window.electron.setExecutorSettings(settings),
  restart: () => window.electron.restartExecutor(),
};

export const electronPlatform: PlatformAdapter = {
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
  accounts,
  executor,
};
