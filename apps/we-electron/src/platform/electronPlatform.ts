import type { Account, AccountHost, AppConfig, PlatformAdapter } from '@we/app-shell/shared';

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
  rename: (id: string, name: string) => window.electron.renameAccount(id, name),
  select: (id: string) => window.electron.selectAccount(id),
  remove: (id: string) => window.electron.removeAccount(id),
  restart: () => window.electron.restartApp(),
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
};
