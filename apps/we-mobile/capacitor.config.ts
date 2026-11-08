import type { CapacitorConfig } from '@capacitor/cli';

import { ERROR_PAGE_PATH, MIN_WEBVIEW_MAJOR } from './src/webViewFloor';

const config: CapacitorConfig = {
  appId: 'org.coasys.app',
  appName: 'Coasys',
  // WE's web build plus the app's error page: `pnpm build:web` here assembles it.
  webDir: 'www',
  server: {
    // The WebView's own origin is https://localhost: a secure context, and WE's stored session
    // (ad4m-connect's localStorage) lives under it.
    androidScheme: 'https',
    // Below the WebView floor, or when WE's page fails to load. See src/webViewFloor.ts.
    errorPath: ERROR_PAGE_PATH,
  },
  android: {
    // WE reaches its executor over https/wss; a page on https://localhost never loads http.
    allowMixedContent: false,
    minWebViewVersion: MIN_WEBVIEW_MAJOR,
  },
};

export default config;
