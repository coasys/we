import path from 'path';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    port: 3000,
    fs: {
      // Allow serving files from workspace root (for seed files from sibling projects)
      allow: ['../..'],
    },
  },
  build: { target: 'esnext' },
  resolve: {
    alias: {
      // Resolve @we/app-framework internal aliases
      '@shared': path.resolve(__dirname, '../../packages/app-framework/src/shared'),
      '@solid': path.resolve(__dirname, '../../packages/app-framework/src/frameworks/solid'),
    },
  },
});
