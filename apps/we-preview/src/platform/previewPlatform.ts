import type { AppConfig, PlatformAdapter } from '@we/app-shell/shared';

/**
 * The host contract, answered for a browser with nothing behind it.
 *
 * `accounts` and `executor` are both omitted, which is the same shape the web host has: there is no
 * data directory to switch between and no backend process to configure. Every surface that would
 * offer those feature-detects and shows nothing, so the omission is a supported state rather than a
 * gap — see `accountStore.canManageAccounts` and `runtimeStore.canConfigureExecutor`.
 *
 * `isDevelopment` is deliberately *not* `import.meta.env.DEV`. This host exists to be screenshotted,
 * and a production build of it should behave identically to the dev server it was iterated in;
 * anything gated on dev-mode would otherwise appear in one and not the other, which is precisely
 * the class of difference a fidelity tool must not have.
 */
export const previewPlatform: PlatformAdapter = {
  resolveAppUrl(app: AppConfig, isDevelopment: boolean): string {
    if (isDevelopment && app.paths.devServer) {
      const host = app.paths.devServer.host || 'localhost';
      return `http://${host}:${app.paths.devServer.port}`;
    }
    return app.paths.webUrl ?? app.paths.dist;
  },

  isDesktop: false,
  isDevelopment: false,
  platform: 'web' as const,
};
