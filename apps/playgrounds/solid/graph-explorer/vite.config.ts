import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  // One solid-js instance across app and libraries. Load-bearing: two instances give two owner
  // graphs and effects silently stop updating, which looks correct on first paint.
  resolve: { dedupe: ['solid-js', 'solid-js/web', 'solid-js/store'] },
  server: {
    port: 3300,
    fs: { allow: ['../../../..'] },
  },
  build: { target: 'esnext' },
});
