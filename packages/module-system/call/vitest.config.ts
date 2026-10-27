import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Tests run as a build with developer features, so the synthetic participants exist to be tested.
  // See `devFeatures.ts` in `@we/module-shared`.
  define: { __WE_DEV_FEATURES__: 'true' },
  test: {
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
  },
});
