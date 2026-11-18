import { fileURLToPath } from 'node:url';

import solidPlugin from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [solidPlugin()],
  resolve: {
    // Test the checked-in source, not a built dist: without the alias, @we/schema-shared resolves
    // to dist/index.js and an edit to shared/src would not be what these tests run.
    alias: { '@we/schema-shared': fileURLToPath(new URL('../../shared/src/index.ts', import.meta.url)) },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.ts'],
  },
});
