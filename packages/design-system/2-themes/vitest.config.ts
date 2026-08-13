import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The sanitiser parses CSS with the browser's own parser, so it needs a DOM. The other suites
    // here are pure functions and do not care.
    environment: 'jsdom',
  },
});
