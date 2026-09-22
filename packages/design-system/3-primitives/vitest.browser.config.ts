import { defineConfig } from 'vitest/config';

/*
  Tests that need a real browser: the cascade, which jsdom does not resolve.

  Node environment, not a browser one — the test drives Chrome through playwright-core itself, which
  keeps it to the Chrome already on the machine (as `apps/we-preview` does) and out of the default
  `test` run, where a missing browser would fail every package's CI job. Run with `test:browser`.
*/
export default defineConfig({
  test: {
    include: ['src/**/*.browser.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
