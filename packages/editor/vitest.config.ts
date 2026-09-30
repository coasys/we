import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // `src/**` as well as `tests/**`: a test written beside the module it covers is the repo's
    // usual placement, and one added here was silently never run — which is the worst outcome
    // available, since it reports as a passing suite.
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
  },
});
