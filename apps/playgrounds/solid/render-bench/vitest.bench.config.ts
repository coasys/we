import solidPlugin from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

/**
 * Headless timing benchmarks. Run on demand (`pnpm bench`), never in CI.
 *
 * They run as ordinary tests with manual timing rather than through `vitest bench`, which is
 * experimental and reported NaN here. Manual sampling also lets this use the same
 * median-of-N-with-warm-up discipline as the browser harness.
 */
export default defineConfig({
  plugins: [solidPlugin()],
  resolve: {
    conditions: ['solid', 'development', 'browser'],
    dedupe: ['solid-js', 'solid-js/web', 'solid-js/store'],
  },
  test: {
    environment: 'happy-dom',
    include: ['bench/**/*.bench.{ts,tsx}'],
    testTimeout: 180_000,
  },
});
