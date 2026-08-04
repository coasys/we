import { invoke } from '@tauri-apps/api/core';
import type { Account, AccountHost, AppConfig, PlatformAdapter } from '@we/app-shell/shared';

import portMap from '../generated/seed-port-map.json';

/**
 * The registry lives on the Rust side — it has to, because the data path is needed to configure
 * the executor before any window exists. This is the command surface over it.
 */
const accounts: AccountHost = {
  list: () => invoke<Account[]>('list_accounts'),
  create: (name: string) => invoke<Account>('create_account', { name }),
  select: (id: string) => invoke<void>('select_account', { id }),
  remove: (id: string) => invoke<void>('remove_account', { id }),
  restart: () => invoke<void>('restart_app'),
};

export const tauriPlatform: PlatformAdapter = {
  resolveAppUrl(app: AppConfig, isDevelopment: boolean): string {
    // Development mode: Use devServer configuration from seed
    if (isDevelopment && app.paths.devServer) {
      const host = app.paths.devServer.host || 'localhost';
      const port = app.paths.devServer.port;
      return `http://${host}:${port}`;
    }

    // Production mode: Use HTTP server ports from generated config
    // Apps are served via HTTP on localhost (similar to Electron)
    const port = portMap[app.id as keyof typeof portMap];
    if (!port) {
      console.error(`No port mapping found for app: ${app.id}`);
      return 'about:blank';
    }

    return `http://localhost:${port}`;
  },

  isDesktop: true,
  get isDevelopment(): boolean {
    return import.meta.env.DEV;
  },
  platform: 'tauri' as const,
  accounts,
};
