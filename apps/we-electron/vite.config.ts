import { resolve } from 'path';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // Resolve @we/app-framework internal aliases
      '@shared': resolve(__dirname, '../../packages/app-framework/src/shared'),
      '@solid': resolve(__dirname, '../../packages/app-framework/src/frameworks/solid'),
    },
  },
  server: { port: 3002 },
  build: { target: 'esnext', outDir: 'dist' },
});
