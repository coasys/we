import solidPlugin from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Two projects so the DOM/Solid setup needed to render components (browser resolve conditions,
    // jsdom, the solid-js transform) is scoped to the component tests and never touches the plain
    // logic tests. Ported from the pre-module layout, where the same split lived in app-framework's
    // vitest config for the same reason.
    projects: [
      {
        test: {
          name: 'logic',
          globals: true,
          include: ['tests/**/*.test.ts'],
        },
      },
      {
        plugins: [solidPlugin()],
        resolve: {
          conditions: ['development', 'browser'],
          // A single solid-js instance across the test-transformed source and prebuilt dists —
          // otherwise Solid event delegation and reactive context silently break.
          dedupe: ['solid-js', 'solid-js/web', 'solid-js/store'],
        },
        test: {
          name: 'components',
          globals: true,
          environment: 'jsdom',
          include: ['tests/**/*.test.tsx'],
        },
      },
    ],
  },
});
