import solidPlugin from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

/**
 * Correctness tests — these gate CI (`pnpm test` at the repo root recurses into every package).
 * Timing benchmarks deliberately live in a separate config: they are noisy on shared runners and
 * must never decide whether a merge is allowed.
 */
export default defineConfig({
  plugins: [solidPlugin()],
  resolve: {
    // 'browser' is required — vitest otherwise resolves solid-js to its server build, which throws
    // "Client-only API called on the server side" as soon as the renderer imports AnimateRenderer.
    conditions: ['solid', 'development', 'browser'],
    dedupe: ['solid-js', 'solid-js/web', 'solid-js/store'],
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
