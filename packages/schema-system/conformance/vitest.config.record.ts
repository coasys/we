import { fileURLToPath } from 'node:url';

import solidPlugin from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

// `pnpm record` runs the navigation half of the vector generation — the part that needs a mounted
// RouteStore over real jsdom history. Excluded from the default projects on purpose: `pnpm test`
// compares vectors, it must never rewrite them.
export default defineConfig({
  plugins: [solidPlugin()],
  resolve: {
    // The vectors pin src, not a built dist: RouteStore imports @we/schema-shared by package
    // name, which would otherwise resolve to dist/index.js and leave a src sabotage invisible.
    alias: { '@we/schema-shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) },
    dedupe: ['solid-js', 'solid-js/web', 'solid-js/store'],
    conditions: ['development', 'browser'],
  },
  test: {
    globals: true,
    env: { TZ: 'UTC' },
    environment: 'jsdom',
    include: ['tests/record-navigation.test.tsx'],
  },
});
