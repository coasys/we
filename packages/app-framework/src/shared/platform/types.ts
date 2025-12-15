import type { Ad4mClient } from '@coasys/ad4m';

export interface PlatformAdapter {
  // Build and return a configured Ad4mClient
  // Each platform handles its own connection mechanism (ad4m-connect, Tauri invoke, Electron IPC, etc.)
  buildAd4mClient(): Promise<Ad4mClient>;

  // Optional: Get raw connection details (for desktop platforms that need to pass to iframes)
  // Web platforms using ad4m-connect don't need this
  getConnectionDetails?(): Promise<{ port: number; token: string }>;

  // Check if running in desktop app (vs web)
  isDesktop: boolean;

  // Platform identifier
  platform: 'web' | 'electron' | 'tauri';
}
