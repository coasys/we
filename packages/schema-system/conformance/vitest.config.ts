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
          include: ['tests/**/*.test.{ts,tsx}'],
          exclude: ['**/node_modules/**', ...SOLID_TESTS, ...RECORD_TESTS],
        },
      },
      {
        plugins: [solidPlugin()],
        resolve: {
          dedupe: ['solid-js', 'solid-js/web', 'solid-js/store'],
          conditions: ['development', 'browser'],
        },
        test: {
          name: 'solid',
          globals: true,
          environment: 'jsdom',
          include: SOLID_TESTS,
        },
      },
    ],
  },
});
