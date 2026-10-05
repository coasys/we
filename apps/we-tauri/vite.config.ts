import { contentSecurityPolicy, rewriteKnockoutGlobalEval } from '@we/csp/vite';
import { globeLayerAssets } from '@we/globe-layers/vite';
import { cesiumAssets } from '@we/globe-widget/vite';
import { resolve } from 'path';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  // The Content-Security-Policy as a meta tag, from `@we/csp` — the builder Electron's header comes
  // from too. The rewrite lets the globe load under a policy without 'unsafe-eval'.
  plugins: [
    solid(),
    contentSecurityPolicy({ host: 'tauri', seedFile: resolve(import.meta.dirname, '../../we-seed.json') }),
    rewriteKnockoutGlobalEval(),
    cesiumAssets(),
    globeLayerAssets(),
  ],

  // Use relative base path for Tauri builds
  base: './',

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      // Resolve @we/app-shell internal aliases
      '@shared': resolve(import.meta.dirname, '../../packages/app-shell/src/shared'),
      '@solid': resolve(import.meta.dirname, '../../packages/app-shell/src/frameworks/solid'),
    },
  },
  assetsInclude: ['**/*.glb'],
  build: {
    // Above the 500 kB default because the chunks that crossed it are the on-demand Cesium and
    // three.js bundles. See apps/we-web/vite.config.ts for the full reasoning and what it costs.
    chunkSizeWarningLimit: 3500,
  },
  // Never pre-bundle local file: deps — hard links break on rebuild, causing
  // Vite's dep optimizer cache to serve stale content after restart.
  optimizeDeps: { exclude: ['@coasys/ad4m'] },
}));
