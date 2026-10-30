/**
 * The rules every registered scenario keeps. A scenario acts as a person, through the apps: after
 * world building (`ctx.worldBuilt()`), the only executor calls it may make are reads for its
 * assertions.
 */
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScenarios } from '../src/runner.ts';
import { defineScenario } from '../src/scenario.ts';
import { SCENARIOS } from '../src/scenarios/index.ts';
import type { Checkout } from '../src/world/checkout.ts';

/** Executor calls that only read: what an assertion may ask after world building. */
const READS = new Set(['identity.status', 'identity.log']);

const dir = join(import.meta.dirname, '../src/scenarios');
const sources = readdirSync(dir)
  .filter((f) => f.endsWith('.ts') && f !== 'index.ts' && f !== 'pending.ts')
  .map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8') }));

describe('the registry', () => {
  it('names each scenario once, in kebab case, with what it proves', () => {
    const ids = SCENARIOS.map((s) => s.meta.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SCENARIOS) {
      expect(s.meta.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(s.meta.proves.length, s.meta.id).toBeGreaterThan(0);
      expect(s.meta.platforms.length, s.meta.id).toBeGreaterThan(0);
    }
  });

  it('runs no scenario on Windows or in production', () => {
    for (const s of SCENARIOS) {
      expect(s.meta.platforms.join()).not.toMatch(/windows/);
      expect(s.meta.worlds.join()).not.toMatch(/production/);
    }
  });

  it('gives every pending scenario a reason, and every scenario that is on something to run', () => {
    expect(() => defineScenario({ ...SCENARIOS[0], state: { state: 'pending', reason: ' ' } })).toThrow(
      /without a reason/,
    );
    expect(() => defineScenario({ ...SCENARIOS[0], state: { state: 'on' }, run: undefined })).toThrow(/nothing to run/);
    for (const s of SCENARIOS) {
      if (s.state.state === 'on') expect(s.run, s.meta.id).toBeTypeOf('function');
      else expect(s.state.reason.length, s.meta.id).toBeGreaterThan(10);
    }
  });
});

describe('what a scenario may do', () => {
  it('finds the scenario sources to check', () => {
    // One source can declare more than one scenario (the same flow with another vault).
    const on = SCENARIOS.filter((s) => s.state.state === 'on').length;
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.length).toBeLessThanOrEqual(on);
  });

  for (const { file, text } of sources) {
    it(`${file} ends world building once, and after that only reads an executor`, () => {
      const marks = text.split('ctx.worldBuilt()').length - 1;
      expect(marks, 'ctx.worldBuilt() calls').toBe(1);
      const after = text.slice(text.indexOf('ctx.worldBuilt()'));
      const calls = [...after.matchAll(/\.call(?:<[^>]*>)?\(\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
      const writes = calls.filter((c) => !READS.has(c));
      expect(writes, `calls after world building`).toEqual([]);
    });
  }
});

describe('the runner', () => {
  it('reports a pending scenario as pending, with its reason, without starting a world', async () => {
    const out = mkdtempSync(join(tmpdir(), 'acceptance-report-'));
    const pending = defineScenario({
      meta: {
        id: 'later',
        title: 'Later',
        proves: ['something'],
        platforms: ['desktop-linux'],
        worlds: ['local'],
        cadence: ['nightly'],
      },
      state: { state: 'pending', reason: 'needs a change that has not landed' },
    });
    // No checkout is touched for a pending scenario.
    const summary = await runScenarios([pending], { checkout: {} as Checkout, out });
    expect(summary).toMatchObject({ passed: 0, failed: 0, pending: 1 });
    expect(summary.results[0]).toMatchObject({
      outcome: 'pending',
      passed: false,
      reason: 'needs a change that has not landed',
    });
    expect(readFileSync(join(out, 'summary.md'), 'utf8')).toContain(
      '| later Later | pending | needs a change that has not landed |',
    );
  });
});
