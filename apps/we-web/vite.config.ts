import path from 'path';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  assetsInclude: ['**/*.glb'],
  plugins: [solidPlugin()],
  server: {
    port: 3000,
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
      // Resolve @we/app-framework internal aliases
      '@shared': path.resolve(__dirname, '../../packages/app-framework/src/shared'),
      '@solid': path.resolve(__dirname, '../../packages/app-framework/src/frameworks/solid'),
    },
  },
});
