import { fileURLToPath } from 'node:url';

import solidPlugin from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

// Tests that mount the real RouteStore over a real jsdom history — the same reason app-shell keeps
// a second project: the node project resolves solid-js to its SSR build, where effects never run.
const SOLID_TESTS = ['tests/navigation.test.tsx', 'tests/render.test.tsx'];
// The recorder is NOT a test: `pnpm record` runs it through vitest.config.record.ts, and it must
// not execute here or `pnpm test` would rewrite the vectors it then compares.
const RECORD_TESTS = ['tests/record-navigation.test.tsx', 'tests/record-render.test.tsx'];

// The vectors pin src, not a built dist. The recorder's mounted RouteStore imports
// @we/schema-shared by package name, and schema-shared's own src imports @we/expressions by name;
// either would otherwise resolve to dist/index.js and leave a src sabotage invisible. It also keeps
// one copy of the expression language: its namespace symbol and function registry are per module.
const SRC = {
  '@we/expressions': fileURLToPath(new URL('../expressions/src/index.ts', import.meta.url)),
  '@we/schema-shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
};

// The renderer vectors mount the real renderer and the host's glue around it (part expansion, the
// router, the gesture gate), which import app-shell's own aliases and the renderer by package name.
export const RENDER_ALIASES = {
  '@we/schema-solid': fileURLToPath(new URL('../frameworks/solid/src/index.ts', import.meta.url)),
  '@shared': fileURLToPath(new URL('../../app-shell/src/shared', import.meta.url)),
  '@solid': fileURLToPath(new URL('../../app-shell/src/frameworks/solid', import.meta.url)),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: SRC },
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
          alias: { ...SRC, ...RENDER_ALIASES },
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
