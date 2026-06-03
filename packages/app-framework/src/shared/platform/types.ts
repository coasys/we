import type { Ad4mClient } from '@coasys/ad4m';

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

export interface PlatformAdapter {
  // Build and return a configured Ad4mClient
  // Each platform handles its own connection mechanism (ad4m-connect, Tauri invoke, Electron IPC, etc.)
  buildAd4mClient(): Promise<Ad4mClient>;

  // Optional: Get raw connection details (for desktop platforms that need to pass to iframes)
  // Web platforms using ad4m-connect don't need this
  getConnectionDetails?(): Promise<{ port: number; token: string; url?: string }>;

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
