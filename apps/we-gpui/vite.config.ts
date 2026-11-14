import { contentSecurityPolicy, rewriteKnockoutGlobalEval } from '@we/csp/vite';
import { globeLayerAssets } from '@we/globe-layers/vite';
import { cesiumAssets } from '@we/globe-widget/vite';
import { resolve } from 'path';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

import { seedPath, weSeed } from '../../scripts/seed-vite.mjs';

/**
 * The Tauri app's build, unchanged in substance: the GPUI shell serves the same kind of bundle from
 * its own scheme (`we://localhost`), and the page reaches the executor on `ws://localhost:<port>`,
 * which the `tauri` CSP profile already allows. Relative base, because the scheme's root is the
 * bundle's root.
 */
export default defineConfig({
  plugins: [
    weSeed(),
    solid(),
    contentSecurityPolicy({ host: 'tauri', seedFile: seedPath() }),
    rewriteKnockoutGlobalEval(),
    cesiumAssets(),
    globeLayerAssets(),
  ],
  base: './',
  clearScreen: false,
  server: { port: 1430, strictPort: true, watch: { ignored: ['**/native/**'] } },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      '@shared': resolve(import.meta.dirname, '../../packages/app-shell/src/shared'),
      '@solid': resolve(import.meta.dirname, '../../packages/app-shell/src/frameworks/solid'),
    },
  },
  assetsInclude: ['**/*.glb'],
  build: {
    // As Tauri's and the web app's: the chunks over the default are the on-demand Cesium and three.js.
    chunkSizeWarningLimit: 3500,
  },
  optimizeDeps: { exclude: ['@coasys/ad4m'] },
});
