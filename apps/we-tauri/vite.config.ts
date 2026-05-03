import { resolve } from 'path';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [solid()],

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
      '@': resolve(__dirname, 'src'),
      // Resolve @we/app-framework internal aliases
      '@shared': resolve(__dirname, '../../packages/app-framework/src/shared'),
      '@solid': resolve(__dirname, '../../packages/app-framework/src/frameworks/solid'),
    },
  },
  assetsInclude: ['**/*.glb'],
  // Never pre-bundle local file: deps — hard links break on rebuild, causing
  // Vite's dep optimizer cache to serve stale content after restart.
  optimizeDeps: { exclude: ['@coasys/ad4m'] },
}));
