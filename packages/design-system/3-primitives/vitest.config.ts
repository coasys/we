import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The primitives are custom elements: anything asserting on rendered output needs a DOM. The
    // stylesheet tests do not, but one environment for the package is simpler than two projects.
    environment: 'jsdom',
    globals: true,
  },
});
