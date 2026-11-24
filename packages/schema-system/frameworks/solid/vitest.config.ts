import { fileURLToPath } from 'node:url';

import solidPlugin from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [solidPlugin()],
  resolve: {
    // Test the checked-in source, not a built dist: without the aliases, @we/schema-shared and the
    // expression language it imports resolve to dist/index.js and an edit to either src would not
    // be what these tests run.
    alias: {
      '@we/expressions': fileURLToPath(new URL('../../expressions/src/index.ts', import.meta.url)),
      '@we/schema-shared': fileURLToPath(new URL('../../shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.ts'],
  },
});
