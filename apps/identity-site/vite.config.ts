import path from 'node:path';

import { defineConfig } from 'vite';

import { endpoints } from './config/endpoints.mjs';
import { portalPlugins, siteOutputs } from './site-build.ts';

const site = endpoints();

export default defineConfig({
  base: '/',
  plugins: [...portalPlugins(), siteOutputs(site)],
  define: { __ENDPOINTS__: JSON.stringify({ platform: site.platform, store: site.store, storeKey: site.storeKey }) },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Same as the portal's window: one script and one stylesheet, no inline preload helper, no inlined assets.
    modulePreload: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        index: path.resolve('index.html'),
        connect: path.resolve('connect/index.html'),
        o: path.resolve('o/index.html'),
      },
    },
  },
});
