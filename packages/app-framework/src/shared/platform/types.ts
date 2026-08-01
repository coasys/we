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
}
