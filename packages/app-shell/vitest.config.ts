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
  'tests/shellPathMemory.test.tsx',
  'tests/shellOverlayRemount.test.tsx',
  // Not a component test, but it drives real `we-iframe` elements with shadow roots and real
  // `MessageEvent`s — the DOM is what is under test.
  'tests/appBridge.test.ts',
  // Nothing renders, but the whole point is the fallback path: a real `document`, a real textarea
  // appended and removed, and `navigator.clipboard` absent the way it is outside a secure context.
  'tests/copyText.test.ts',
  'tests/templateBoundary.test.tsx',
  // Imports the shell's own schemas, which reach Solid modules that refuse to load outside a
  // browser environment. Nothing here renders — the DOM is a condition of the import, not the test.
  'tests/tierFit.test.ts',
  // Drives a real signal through a real effect, which is the half of the behaviour a comparator
  // alone cannot show. Nothing renders, but the node project resolves solid-js to its SSR build,
  // where `createEffect` does nothing at all — so the test passes there for the wrong reason.
  'tests/datasetIdentity.test.ts',
];

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './.coverage',
      /*
        Everything under `src`, whether a test loaded it or not.

        Without an `include`, v8 reports only the files the run actually imported — so a store no
        test touches is not 0%, it is *absent*, and the percentage is computed over the half that
        happens to be covered. Seven of seventeen stores were missing from the report entirely and
        the figure read 49% of the ten that were there, which is a number about a subset nobody
        chose. Listing the whole tree makes an untested file count as the zero it is.

        The point of the change is that the number stops flattering. `src/frameworks/**` used to be
        excluded outright — all 9,380 lines of the stores — for the same reason and with the same
        effect.
      */
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['**/node_modules/**', 'tests/**', 'src/**/index.ts', 'src/seed/cli.ts', 'src/seed/examples.ts'],
      /*
        Still no threshold, deliberately. A gate set to today's number ratchets only by accident,
        and the first honest reading is the input to deciding what to test rather than a line to
        defend. What was missing was not a threshold — it was a number that meant anything.
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
