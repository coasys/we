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
    /*
      The hole in the rule above: these are correctness tests whose *duration* was still deciding
      whether a merge was allowed.

      Every test here mounts a hundred real cards several times over — the equivalence test does it
      five times, once per rung, because comparing the rungs against each other rather than against a
      hand-written string is the whole point of the file. That is ~2.2s on a developer's machine and
      more than twice that on a shared runner, so it sat at half of vitest's 5s default and tipped
      over it in CI. Nothing was wrong: the assertions are about what rendered, never about how fast.

      So the timeout is set where it only catches a genuine hang. It costs nothing while the tests
      pass, and a slow runner stops being able to fail a branch that did not touch this package.
    */
    testTimeout: 30000,
  },
});
