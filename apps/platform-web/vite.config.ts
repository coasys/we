import path from 'path';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    port: 3100,
    fs: {
      // Allow serving files from workspace root (for seed files from sibling projects)
      allow: ['../..'],
    },
  },
  build: { target: 'esnext' },
  // Never pre-bundle local file: deps — hard links break on rebuild, causing
  // Vite's dep optimizer cache to serve stale content after restart.
  optimizeDeps: { exclude: ['@coasys/ad4m', '@coasys/ad4m-connect'] },
  resolve: {
    alias: {
      // Resolve @we/app-shell internal aliases
      '@shared': path.resolve(import.meta.dirname, '../../packages/app-shell/src/shared'),
      '@solid': path.resolve(import.meta.dirname, '../../packages/app-shell/src/frameworks/solid'),
    },
  },
});
