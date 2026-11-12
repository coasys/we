#!/usr/bin/env node
/**
 * Runs one of WE's end-to-end suites, after building what it needs and fetching the executor.
 *
 *   pnpm e2e                                   list the suites
 *   pnpm e2e <suite> [--tier stub|real] [--only v2,v4] [--no-build]
 *
 * Each suite's own script still runs it on its own: this only does the steps around it that are easy
 * to forget, in order — build, `pnpm ad4m:executor`, run — and stops at the first that fails. So
 * `pnpm --filter @we/app-web test:spaces` with `AD4M_EXECUTOR` set, as the ad4m nightly runs it, is
 * the same suite as `pnpm e2e spaces`.
 *
 * `--tier` and `--only` are the spaces suite's `COASYS_SPACES_TIER` and `COASYS_SPACES_ONLY`.
 * `--no-build` runs against whatever was built last. The calls and spaces suites both serve
 * `apps/we-web/dist`, each from a build with its own seed, so one after the other without a build
 * runs the second against the first's app.
 *
 * The three kinds of test, and where each runs in CI, are in `docs/testing/e2e.md`.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const FETCH_EXECUTOR = { label: 'executor', command: 'pnpm', args: ['ad4m:executor'] };

/**
 * The suites, by name. `kind` is one of the three in `docs/testing/e2e.md`; `build` and `run` are the
 * commands, run from the repository root unless a step names a `cwd`.
 */
export const SUITES = {
  calls: {
    kind: 'journey',
    about: 'One account in a call from several tabs and devices, on the SFU and on the mesh, in the built web app.',
    executor: true,
    build: [{ command: 'pnpm', args: ['build:web'] }],
    run: [{ command: 'pnpm', args: ['--filter', '@we/app-web', 'test:live'] }],
  },
  spaces: {
    kind: 'journey',
    about: 'The Coasys app, vertical by vertical (apps/we-web/e2e/coasys-spaces).',
    executor: true,
    tiers: ['stub', 'real'],
    build: [{ command: 'pnpm', args: ['build:web'], env: { WE_SEED: 'seeds/coasys.seed.json' } }],
    run: [{ command: 'pnpm', args: ['--filter', '@we/app-web', 'test:spaces'] }],
  },
  'backend-live': {
    kind: 'contract',
    about: "The AD4M adapter against a real executor: the capability check and the backend contract's suite.",
    executor: true,
    build: [
      {
        command: 'pnpm',
        args: ['--filter', '@we/backend-ad4m^...', '--filter', '@we/backend-conformance...', 'build'],
      },
    ],
    run: [{ command: 'pnpm', args: ['verify:ad4m'] }],
  },
  'custody-live': {
    kind: 'contract',
    about: 'The custody service with a real identity-store and two executors (needs AD4M_REPO).',
    executor: true,
    build: [],
    run: [
      {
        command: 'cargo',
        args: ['test', '--features', 'cheap-kdf', '--test', 'live', '--', '--nocapture'],
        cwd: 'crates/custody',
        env: { CUSTODY_LIVE: '1' },
      },
    ],
  },
  'browser-layout': {
    kind: 'layout',
    about: "The app shell's layout cases, swept across widths in Chrome. No executor.",
    executor: false,
    build: [{ command: 'pnpm', args: ['--filter', '@we/app-shell^...', 'build'] }],
    run: [{ command: 'pnpm', args: ['--filter', '@we/app-shell', 'test:browser'] }],
  },
  'primitives-browser': {
    kind: 'layout',
    about: 'The primitives where only a browser can answer: the cascade, the top layer, fitting. No executor.',
    executor: false,
    build: [{ command: 'pnpm', args: ['--filter', '@we/primitives^...', 'build'] }],
    run: [{ command: 'pnpm', args: ['--filter', '@we/primitives', 'test:browser'] }],
  },
};

/** The flags `pnpm e2e <suite>` takes, read from its arguments. Throws on anything else. */
export function parseArgs(argv) {
  const options = { suite: undefined, tier: undefined, only: undefined, build: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = (name) => {
      const inline = arg.startsWith(`${name}=`) ? arg.slice(name.length + 1) : undefined;
      const next = inline ?? argv[++i];
      if (!next || next.startsWith('--')) throw new Error(`${name} needs a value`);
      return next;
    };
    if (arg === '--no-build') options.build = false;
    else if (arg === '--tier' || arg.startsWith('--tier=')) options.tier = value('--tier');
    else if (arg === '--only' || arg.startsWith('--only=')) options.only = value('--only');
    else if (arg.startsWith('-')) throw new Error(`Unknown flag ${arg}`);
    else if (options.suite) throw new Error(`One suite at a time: ${options.suite}, then ${arg}`);
    else options.suite = arg;
  }
  return options;
}

/**
 * The steps `pnpm e2e` takes for these options, in order: each a command, its arguments, where it
 * runs and what it adds to the environment. Throws for a suite that does not exist or a flag the
 * suite does not take.
 */
export function plan(options) {
  const suite = SUITES[options.suite];
  if (!suite) throw new Error(`No suite called ${options.suite}. Suites: ${Object.keys(SUITES).join(', ')}`);
  if ((options.tier || options.only) && !suite.tiers)
    throw new Error(`--tier and --only apply to the spaces suite, not ${options.suite}`);
  if (options.tier && !suite.tiers.includes(options.tier))
    throw new Error(`--tier is one of ${suite.tiers.join(', ')}, not ${options.tier}`);

  const suiteEnv = {
    ...(options.tier ? { COASYS_SPACES_TIER: options.tier } : {}),
    ...(options.only ? { COASYS_SPACES_ONLY: options.only } : {}),
  };
  const steps = [];
  if (options.build) for (const step of suite.build) steps.push({ label: 'build', ...step });
  if (suite.executor) steps.push(FETCH_EXECUTOR);
  for (const step of suite.run) steps.push({ label: 'run', ...step, env: { ...step.env, ...suiteEnv } });
  return steps.map((step) => ({ cwd: '.', env: {}, ...step }));
}

/** The suites, as `pnpm e2e` with no arguments prints them. */
export function listing() {
  const width = Math.max(...Object.keys(SUITES).map((name) => name.length));
  const lines = ['Usage: pnpm e2e <suite> [--tier stub|real] [--only v2,v4] [--no-build]', '', 'Suites:'];
  for (const [name, suite] of Object.entries(SUITES))
    lines.push(`  ${name.padEnd(width)}  ${suite.kind.padEnd(8)}  ${suite.about}`);
  lines.push('', 'Kinds and CI homes: docs/testing/e2e.md');
  return lines.join('\n');
}

function main(argv) {
  let steps;
  try {
    const options = parseArgs(argv);
    if (!options.suite) {
      console.log(listing());
      return 0;
    }
    steps = plan(options);
  } catch (error) {
    console.error(`[e2e] ${error.message}\n\n${listing()}`);
    return 2;
  }
  for (const step of steps) {
    const shown = [...Object.entries(step.env).map(([k, v]) => `${k}=${v}`), step.command, ...step.args].join(' ');
    console.log(`[e2e] ${step.label}: ${shown}${step.cwd === '.' ? '' : ` (in ${step.cwd})`}`);
    const result = spawnSync(step.command, step.args, {
      cwd: join(ROOT, step.cwd),
      env: { ...process.env, ...step.env },
      stdio: 'inherit',
    });
    if (result.error) {
      console.error(`[e2e] Could not run ${step.command}: ${result.error.message}`);
      return 1;
    }
    if (result.status !== 0) {
      console.error(`[e2e] ${step.label} failed (${result.signal ?? `exit ${result.status}`})`);
      return result.status ?? 1;
    }
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
