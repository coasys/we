import path from 'path';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  assetsInclude: ['**/*.glb'],
  plugins: [solidPlugin()],
  server: {
    // 3000 is we-web, 3200 is the portable-slice playground. Distinct so the preview host can run
    // beside a real app — comparing the two is how you find out the preview is lying.
    port: 3100,
    // The root seed lives above this package.
    fs: { allow: ['../..'] },
  },
  build: { target: 'esnext' },
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, '../../packages/app-shell/src/shared'),
      '@solid': path.resolve(import.meta.dirname, '../../packages/app-shell/src/frameworks/solid'),
    },
  },
});
