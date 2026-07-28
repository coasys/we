import { fileURLToPath } from 'node:url';

import solidPlugin from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: {
    // Two projects so the DOM/Solid setup needed to render components (browser resolve
    // conditions, jsdom, the solid-js transform) is scoped to the assistant component tests
    // and never touches the existing node/logic tests — whose seed code imports Node built-ins
    // that the `browser` condition would otherwise externalize.
    projects: [
      {
        // Existing logic/seed tests — node resolution, no DOM.
        test: {
          name: 'node',
          globals: true,
          include: ['tests/**/*.test.{ts,tsx}'],
          exclude: ['tests/assistant/**', '**/node_modules/**'],
        },
      },
      {
        // Assistant component tests — real Solid rendering in jsdom.
        plugins: [solidPlugin()],
        resolve: {
          conditions: ['development', 'browser'],
          // A single solid-js instance across the test-transformed source and the prebuilt
          // design-system dist — otherwise Solid event delegation and reactive context break.
          dedupe: ['solid-js', 'solid-js/web', 'solid-js/store'],
          alias: {
            '@shared': r('./src/shared'),
            '@solid': r('./src/frameworks/solid'),
          },
        },
        test: {
          name: 'dom',
          globals: true,
          environment: 'jsdom',
          include: ['tests/assistant/**/*.test.{ts,tsx}'],
          // Transform the prebuilt @we/* + solid packages through vite (rather than loading them
          // as external node deps) so they resolve the same deduped solid-js instance as the
          // test-compiled source.
          server: { deps: { inline: [/@we\//, /solid-js/, /@solidjs\//] } },
        },
      },
    ],
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
  },
});
