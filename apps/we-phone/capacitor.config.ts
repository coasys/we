import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.coasys.app',
  appName: 'Coasys',
  // WE's real web build plus the phone's pages: `pnpm build:web` here assembles it.
  webDir: 'www',
  server: {
    // The WebView's own origin is https://localhost. Nothing it loads is cleartext, and it opens no
    // connection to the desktop itself: the plugin does TLS.
    androidScheme: 'https',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    // Debug builds only (Capacitor's default follows the build type); the spike's measurements
    // drive the diagnostic page over the WebView's DevTools.
  },
};

export default config;
