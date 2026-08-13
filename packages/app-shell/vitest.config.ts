import { fileURLToPath } from 'node:url';

import solidPlugin from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Mirror tsconfig's path aliases for source files imported through the test graph.
const alias = { '@shared': r('./src/shared'), '@solid': r('./src/frameworks/solid') };

// Tests that mount real Solid components/providers — they need jsdom, browser resolve
// conditions, and the solid transform. Everything else stays in the plain node project.
const SOLID_TESTS = [
  'tests/executorFreeBoot.test.tsx',
  'tests/runtimeStore.test.tsx',
  'tests/accountStore.test.tsx',
  'tests/profileStore.test.tsx',
  'tests/routeStore.test.tsx',
  'tests/shellRouteStore.test.tsx',
  // Not a component test, but it drives real `we-iframe` elements with shadow roots and real
  // `MessageEvent`s — the DOM is what is under test.
  'tests/appBridge.test.ts',
  'tests/templateBoundary.test.tsx',
  // Imports the shell's own schemas, which reach Solid modules that refuse to load outside a
  // browser environment. Nothing here renders — the DOM is a condition of the import, not the test.
  'tests/tierFit.test.ts',
];

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './.coverage',
      exclude: ['**/node_modules/**', 'tests/**', 'src/**/index.ts', 'src/seed/cli.ts', 'src/seed/examples.ts'],
      /*
        `src/frameworks/**` used to be excluded — all 9,380 lines of the stores, the largest and
        least-covered part of the biggest package in the repo. Every coverage number the project
        produced was therefore measured over its safe half, which is precisely why the store gap
        stayed invisible while the figure looked respectable.

        Included now, with no threshold attached. A number nobody can see is not a gate, and a gate
        set to today's number is a gate that only ever ratchets by accident; the first honest reading
        is the input to deciding what to test, which is what the audit's P4-2 asks for.
      */
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
