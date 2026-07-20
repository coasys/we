import solidPlugin from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [solidPlugin()],
  resolve: {
    // 'solid' first so @we/schema-solid resolves to its src/ rather than a possibly stale dist/ —
    // the whole point is measuring the renderer as it currently is. 'browser' is required because
    // vitest otherwise picks solid-js's server build, which throws "Client-only API called on the
    // server side" as soon as the renderer imports AnimateRenderer.
    conditions: ['solid', 'development', 'browser'],
  },
  test: {
    environment: 'happy-dom',
    include: ['bench/**/*.{bench,probe}.{ts,tsx}'],
    // Building thousands of nodes repeatedly is well past the 5s default.
    testTimeout: 180_000,
  },
});
