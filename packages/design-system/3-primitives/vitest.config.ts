import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The primitives are custom elements: anything asserting on rendered output needs a DOM. The
    // stylesheet tests do not, but one environment for the package is simpler than two projects.
    // Belt and braces with the tsup exclusion: a compiled test in `dist` is never the one to run.
    exclude: ['**/node_modules/**', 'dist/**'],
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
});
