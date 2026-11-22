import { defineConfig } from 'vitest/config';

import { portalPlugins } from './site-build.ts';

export default defineConfig({
  plugins: portalPlugins(),
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
});
