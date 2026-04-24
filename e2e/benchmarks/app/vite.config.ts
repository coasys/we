import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import path from 'path';

export default defineConfig({
  plugins: [solidPlugin()],
  root: path.resolve(__dirname),
  server: {
    port: 14_600,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@models': path.resolve(__dirname, '../models'),
      '@helpers': path.resolve(__dirname, '../helpers'),
    },
  },
});
