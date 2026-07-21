import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  // Single solid-js instance across app + libraries. Load-bearing for the same reason as the
  // sibling portable-ui-slice harness: two instances give two owner graphs, and scheduled effects
  // silently stop updating while the initial paint still looks correct.
  resolve: { dedupe: ['solid-js', 'solid-js/web', 'solid-js/store'] },
  server: { port: 3300 },
  build: { target: 'esnext' },
});
