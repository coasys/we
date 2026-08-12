/**
 * The desktop platform adapter, parameterized by transport.
 *
 * Electron and Tauri had structurally identical adapters — the same
 * resolveAppUrl, the same account/executor host shape — differing only in how
 * a call crosses the process boundary (IPC vs invoke) and where the port map
 * is generated. That transport is what each app supplies; everything else
 * lives here once.
 */
import type { AccountHost, AppConfig, ExecutorHost, PlatformAdapter } from './types';

export interface DesktopPlatformOptions {
  platform: 'electron' | 'tauri';
  /** Auto-generated seed app id → local HTTP port mapping. */
  portMap: Record<string, number>;
  /** Read at access time so bundler-injected DEV flags stay live. */
  isDevelopment: () => boolean;
  accounts: AccountHost;
  executor: ExecutorHost;
}

export function createDesktopPlatform(options: DesktopPlatformOptions): PlatformAdapter {
  return {
    resolveAppUrl(app: AppConfig, isDevelopment: boolean): string {
      // Development mode: use the devServer configuration from the seed.
      if (isDevelopment && app.paths.devServer) {
        const host = app.paths.devServer.host || 'localhost';
        const port = app.paths.devServer.port;
        return `http://${host}:${port}`;
      }

      // Production mode: apps are served over local HTTP on generated ports.
      const port = options.portMap[app.id];
      if (!port) {
        console.error(`No port mapping found for app: ${app.id}`);
        return 'about:blank';
      }

      return `http://localhost:${port}`;
    },

    isDesktop: true,
    get isDevelopment(): boolean {
      return options.isDevelopment();
    },
    platform: options.platform,
    accounts: options.accounts,
    executor: options.executor,
  };
}
