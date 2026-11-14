import { fileURLToPath } from 'node:url';

import solidPlugin from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

// Tests that mount the real RouteStore over a real jsdom history — the same reason app-shell keeps
// a second project: the node project resolves solid-js to its SSR build, where effects never run.
const SOLID_TESTS = ['tests/navigation.test.tsx'];
// The recorder is NOT a test: `pnpm record` runs it through vitest.config.record.ts, and it must
// not execute here or `pnpm test` would rewrite the vectors it then compares.
const RECORD_TESTS = ['tests/record-navigation.test.tsx'];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          globals: true,
          // Vectors are recorded under TZ=UTC (record.ts); the calendar host sources are
          // timezone-sensitive, so the comparison must run in the same zone for everyone.
          env: { TZ: 'UTC' },
          include: ['tests/**/*.test.{ts,tsx}'],
          exclude: ['**/node_modules/**', ...SOLID_TESTS, ...RECORD_TESTS],
        },
      },
      {
        plugins: [solidPlugin()],
        resolve: {
          // The vectors pin src, not a built dist: the recorder's mounted RouteStore imports
          // @we/schema-shared by package name, which would otherwise resolve to dist/index.js.
          alias: { '@we/schema-shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) },
          dedupe: ['solid-js', 'solid-js/web', 'solid-js/store'],
          conditions: ['development', 'browser'],
        },
        test: {
          name: 'solid',
          globals: true,
          env: { TZ: 'UTC' },
          environment: 'jsdom',
          include: SOLID_TESTS,
        },
      },
    ],
  },
});
