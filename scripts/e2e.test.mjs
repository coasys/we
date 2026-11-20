import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { listing, parseArgs, plan, SUITES } from './e2e.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const shown = (steps) => steps.map((s) => [s.label, s.command, ...s.args].join(' '));

describe('parseArgs', () => {
  it('reads a suite and its flags, in either spelling', () => {
    assert.deepEqual(parseArgs(['spaces', '--tier', 'real', '--only=v2,v4', '--no-build']), {
      suite: 'spaces',
      tier: 'real',
      only: 'v2,v4',
      build: false,
    });
  });

  it('takes no arguments as a request for the list', () => {
    assert.equal(parseArgs([]).suite, undefined);
  });

  it('refuses an unknown flag, a flag without its value, and two suites', () => {
    assert.throws(() => parseArgs(['calls', '--fast']), /Unknown flag --fast/);
    assert.throws(() => parseArgs(['spaces', '--tier']), /--tier needs a value/);
    assert.throws(() => parseArgs(['spaces', '--tier', '--no-build']), /--tier needs a value/);
    assert.throws(() => parseArgs(['calls', 'spaces']), /One suite at a time/);
  });
});

describe('plan', () => {
  it('builds, fetches the executor, then runs', () => {
    assert.deepEqual(shown(plan(parseArgs(['calls']))), [
      'build pnpm build:web',
      'executor pnpm ad4m:executor',
      'run pnpm --filter @we/app-web test:live',
    ]);
  });

  it('builds the spaces suite with the Coasys seed and passes the tier and the verticals on', () => {
    const steps = plan(parseArgs(['spaces', '--tier', 'stub', '--only', 'v1']));
    assert.deepEqual(steps[0].env, { WE_SEED: 'seeds/coasys.seed.json' });
    assert.deepEqual(steps.at(-1).env, { COASYS_SPACES_TIER: 'stub', COASYS_SPACES_ONLY: 'v1' });
    assert.equal(steps.at(-1).args.at(-1), 'test:spaces');
  });

  it('skips the build with --no-build, and the executor for a suite that runs none', () => {
    assert.deepEqual(shown(plan(parseArgs(['calls', '--no-build']))), [
      'executor pnpm ad4m:executor',
      'run pnpm --filter @we/app-web test:live',
    ]);
    assert.deepEqual(shown(plan(parseArgs(['browser-layout', '--no-build']))), [
      'run pnpm --filter @we/app-shell test:browser',
    ]);
  });

  it('runs the custody test with cargo, in its crate, switched on', () => {
    const run = plan(parseArgs(['custody-live'])).at(-1);
    assert.equal(run.command, 'cargo');
    assert.equal(run.cwd, 'crates/custody');
    assert.deepEqual(run.env, { CUSTODY_LIVE: '1' });
    assert.ok(run.args.includes('cheap-kdf'));
  });

  it('refuses a suite that does not exist, and the spaces flags on another suite', () => {
    assert.throws(() => plan(parseArgs(['nope'])), /No suite called nope/);
    assert.throws(() => plan(parseArgs(['calls', '--tier', 'stub'])), /apply to the spaces suite/);
    assert.throws(() => plan(parseArgs(['spaces', '--tier', 'fake'])), /one of stub, real/);
  });
});

describe('the suites', () => {
  it('lists every suite', () => {
    const text = listing();
    for (const name of Object.keys(SUITES)) assert.match(text, new RegExp(`^  ${name} `, 'm'));
  });

  it('name scripts that exist in the packages they filter to', () => {
    const scripts = (dir) => JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8')).scripts;
    const where = {
      '@we/app-web': 'apps/we-web',
      '@we/app-shell': 'packages/app-shell',
      '@we/primitives': 'packages/design-system/3-primitives',
    };
    const root = scripts('.');
    for (const suite of Object.values(SUITES)) {
      for (const step of [...suite.build, ...suite.run]) {
        if (step.command !== 'pnpm') continue;
        const [first, second, third] = step.args;
        if (first === '--filter' && where[second]) assert.ok(scripts(where[second])[third], `${second} ${third}`);
        else if (first !== '--filter') assert.ok(root[first], first);
      }
    }
  });
});
