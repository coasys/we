import type { AppConfig, PlatformAdapter } from '@we/app-framework/shared';

import portMap from '../generated/seed-port-map.json';

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
};
