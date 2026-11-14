import solidPlugin from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

// `pnpm record` runs the navigation half of the vector generation — the part that needs a mounted
// RouteStore over real jsdom history. Excluded from the default projects on purpose: `pnpm test`
// compares vectors, it must never rewrite them.
export default defineConfig({
  plugins: [solidPlugin()],
  resolve: {
    dedupe: ['solid-js', 'solid-js/web', 'solid-js/store'],
    conditions: ['development', 'browser'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/record-navigation.test.tsx'],
  },
});
