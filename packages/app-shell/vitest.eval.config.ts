import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * The context eval — a live run against a node, kept apart from `pnpm test` because it needs an
 * executor with models and spends tokens. `pnpm --filter @we/app-shell eval:context`.
 */
export default defineConfig({
  test: {
    name: 'eval',
    alias: { '@shared': r('./src/shared'), '@solid': r('./src/frameworks/solid') },
    include: ['eval/**/*.eval.ts'],
    // One case can take minutes on a slow model, and cases run one after another on purpose: a
    // single node answering several at once would make every timing a measure of the queue.
    testTimeout: 15 * 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
