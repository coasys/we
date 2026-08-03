import solidPlugin from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

// bundledModules.test.ts imports the bundled module definitions, and the assistant module ships its
// own Solid components — so that import chain needs the browser build of solid-js and the solid
// transform. Everything else stays in the plain node project.
const MODULE_TESTS = ['tests/bundledModules.test.ts'];

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './.coverage',
      exclude: [
        '**/node_modules/**',
        'tests/**',
        'src/**/index.ts',
        'src/frameworks/**',
        'src/seed/cli.ts',
        'src/seed/examples.ts',
      ],
    },
    projects: [
      {
        test: {
          name: 'node',
          globals: true,
          include: ['tests/**/*.test.{ts,tsx}'],
          exclude: ['**/node_modules/**', ...MODULE_TESTS],
        },
      },
      {
        plugins: [solidPlugin()],
        resolve: {
          conditions: ['development', 'browser'],
          // A single solid-js instance across transformed source and prebuilt dists.
          dedupe: ['solid-js', 'solid-js/web', 'solid-js/store'],
        },
        test: {
          name: 'modules',
          globals: true,
          environment: 'jsdom',
          include: MODULE_TESTS,
        },
      },
    ],
  },
});
