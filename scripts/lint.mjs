#!/usr/bin/env node
/**
 * `pnpm lint`: ESLint once per workspace package, a few at a time, and once over the files outside
 * every package.
 *
 * One process over the whole repository is the obvious shape and the wrong one. The type-aware rules
 * (see "typescript/type-aware" in eslint.config.js) need a TypeScript program for each package, and
 * typescript-eslint's project service keeps every program it opens until the process ends: across the
 * workspace that is about 15 GB. A process per package holds only its own, about 3 GB for app-shell,
 * the largest, and well under 2 GB for the rest. Run in parallel, the whole lint is also faster.
 *
 * The run over everything outside the packages (scripts, root config files) opens no program, because
 * the type-aware block covers only the packages' `src`.
 *
 * `pnpm lint:fix` passes `--fix` through. Each run's output is printed when it finishes, so the
 * findings of one package stay together.
 */
import { execFileSync, spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ESLINT = join(ROOT, 'node_modules/eslint/bin/eslint.js');
/** Four at once keeps the peak near 7 GB, inside a 16 GB CI runner, and uses its four cores. */
const AT_ONCE = Math.min(4, availableParallelism());
const passThrough = process.argv.slice(2);

const packages = JSON.parse(
  execFileSync('pnpm', ['ls', '-r', '--depth', '-1', '--json'], { cwd: ROOT, encoding: 'utf8' }),
)
  .map((pkg) => relative(ROOT, pkg.path))
  .filter(Boolean)
  .sort();

const runs = [
  ...packages.map((dir) => ({ label: dir, args: [dir] })),
  { label: 'outside the packages', args: ['.', ...packages.map((dir) => `--ignore-pattern=${dir}/**`)] },
];

function lint({ label, args }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ESLINT, ...args, '--max-warnings', '0', ...passThrough], { cwd: ROOT });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (code) => {
      if (output.trim()) process.stdout.write(`\n── ${label}\n${output}`);
      resolve(code === 0);
    });
  });
}

const failed = [];
let next = 0;
await Promise.all(
  Array.from({ length: AT_ONCE }, async () => {
    while (next < runs.length) {
      const run = runs[next++];
      if (!(await lint(run))) failed.push(run.label);
    }
  }),
);

if (failed.length) {
  console.error(`\nLint failed in ${failed.length} of ${runs.length} runs: ${failed.sort().join(', ')}`);
  process.exit(1);
}
console.log(`Lint clean: ${packages.length} packages and the files outside them.`);
