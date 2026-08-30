import { resolve } from 'path';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  assetsInclude: ['**/*.glb'],
  base: './',
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      // Resolve @we/app-shell internal aliases
      '@shared': resolve(import.meta.dirname, '../../packages/app-shell/src/shared'),
      '@solid': resolve(import.meta.dirname, '../../packages/app-shell/src/frameworks/solid'),
    },
  },
  server: { port: 3002 },
  build: {
    target: 'esnext',
    outDir: 'dist',
    // Above the 500 kB default because the chunks that crossed it are the on-demand Cesium and
    // three.js bundles. See apps/we-web/vite.config.ts for the full reasoning and what it costs.
    chunkSizeWarningLimit: 3500,
  },
  // Never pre-bundle local file: deps — hard links break on rebuild, causing
  // Vite's dep optimizer cache to serve stale content after restart.
  optimizeDeps: { exclude: ['@coasys/ad4m'] },
});
