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
    //
    // Derived from WE_EVAL_TIMEOUT, the per-turn limit, because a case spends several turns: a cap
    // that did not follow it would kill the case before the limit it was given, and report a
    // timeout the run had not actually reached. Six turns is the most a case makes.
    testTimeout: Math.max(15 * 60_000, (Number(process.env.WE_EVAL_TIMEOUT) || 180) * 1000 * 6),
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
