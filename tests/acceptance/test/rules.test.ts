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

/**
 * Screens that show a secret, by their title, and the secret. A step that waits for one of them
 * ends on it or passes through it, so it declares `shows`: the runner then keeps no screenshot of
 * it, which the scan could not read, and no window text.
 */
const SECRET_SCREENS = new Map([
  ['Your 12 words', 'the 12 words'],
  ['Send this link to your device', 'the offer link'],
]);

/** Each step a source runs (`step(` or `ctx.step(`), as the text of its whole call. */
function stepCalls(text: string): string[] {
  const calls: string[] = [];
  for (const m of text.matchAll(/(?<![\w.])(?:ctx\.)?step\(/g)) {
    let depth = 0;
    let quote = '';
    for (let i = m.index + m[0].length - 1; i < text.length; i += 1) {
      const c = text[i];
      if (quote) {
        if (c === '\\') i += 1;
        else if (c === quote) quote = '';
        continue;
      }
      if (c === '/' && text[i + 1] === '/') i = text.indexOf('\n', i);
      else if (c === '/' && text[i + 1] === '*') i = text.indexOf('*/', i) + 1;
      else if (c === "'" || c === '"' || c === '`') quote = c;
      else if (c === '(') depth += 1;
      else if (c === ')' && --depth === 0) {
        calls.push(text.slice(m.index, i + 1));
        break;
      }
    }
  }
  return calls;
}

describe('what a step keeps', () => {
  const flows = join(import.meta.dirname, '../src/flows');
  const all = [
    ...sources.map((s) => ({ file: `scenarios/${s.file}`, text: s.text })),
    ...readdirSync(flows)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => ({ file: `flows/${f}`, text: readFileSync(join(flows, f), 'utf8') })),
  ];

  it('finds the steps that reach a secret screen', () => {
    const reaching = all.flatMap(({ text }) =>
      stepCalls(text).filter((call) => [...SECRET_SCREENS.keys()].some((title) => call.includes(`'${title}'`))),
    );
    // The first-run step that opens on the words, the words step, and the offer link step.
    expect(reaching.length).toBeGreaterThanOrEqual(3);
  });

  for (const { file, text } of all) {
    it(`${file}: every step that reaches a screen with a secret on it declares shows`, () => {
      for (const call of stepCalls(text)) {
        for (const [title, secret] of SECRET_SCREENS) {
          if (!call.includes(`'${title}'`)) continue;
          const name = /step\(\s*(['"`])(.*?)\1/s.exec(call)?.[2];
          expect(call, `the step "${name}" reaches "${title}"`).toContain(`shows: '${secret}'`);
        }
      }
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
