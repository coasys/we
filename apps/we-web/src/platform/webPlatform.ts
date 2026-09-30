import type { AppConfig, PlatformAdapter } from '@we/app-shell/shared';

export const webPlatform: PlatformAdapter = {
  resolveAppUrl(app: AppConfig, isDevelopment: boolean): string {
    // Development mode: Use devServer configuration from seed
    if (isDevelopment && app.paths.devServer) {
      const host = app.paths.devServer.host || 'localhost';
      const port = app.paths.devServer.port;
      return `http://${host}:${port}`;
    }

    // Production mode: use webUrl if configured, otherwise fall back to dist path
    return app.paths.webUrl ?? app.paths.dist;
  },

  isDesktop: false,
  get isDevelopment(): boolean {
    return import.meta.env.DEV;
  },
  platform: 'web' as const,
};
