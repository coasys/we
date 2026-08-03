import { fileURLToPath } from 'node:url';

import solidPlugin from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Mirror tsconfig's path aliases for source files imported through the test graph.
const alias = { '@shared': r('./src/shared'), '@solid': r('./src/frameworks/solid') };

// Tests that mount real Solid components/providers — they need jsdom, browser resolve
// conditions, and the solid transform. Everything else stays in the plain node project.
const SOLID_TESTS = ['tests/executorFreeBoot.test.tsx'];

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
          alias,
          globals: true,
          include: ['tests/**/*.test.{ts,tsx}'],
          exclude: ['**/node_modules/**', ...SOLID_TESTS],
        },
      },
      {
        plugins: [solidPlugin()],
        resolve: {
          // A single solid-js instance across transformed source and prebuilt dists.
          dedupe: ['solid-js', 'solid-js/web', 'solid-js/store'],
          conditions: ['development', 'browser'],
        },
        test: {
          name: 'solid',
          alias,
          globals: true,
          environment: 'jsdom',
          include: SOLID_TESTS,
        },
      },
    ],
  },
});
