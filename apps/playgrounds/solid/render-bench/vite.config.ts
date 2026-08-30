import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  // Single solid-js instance across app + libraries. Load-bearing for the same reason as the
  // sibling portable-ui-slice harness: two instances give two owner graphs, and scheduled effects
  // silently stop updating while the initial paint still looks correct.
  resolve: { dedupe: ['solid-js', 'solid-js/web', 'solid-js/store'] },
  server: { port: 3300 },
  build: {
    target: 'esnext',
    /*
      A harness, built as one bundle on purpose: it is loaded from localhost and read end to end,
      so splitting it would only put chunk boundaries between the things it exists to compare.
      Above the flat 500 kB default so the warning means "this grew unexpectedly" rather than
      firing on every build.
    */
    chunkSizeWarningLimit: 1000,
  },
});
