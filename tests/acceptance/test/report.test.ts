import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Scenario } from '../src/scenario.ts';
import type { ScenarioResult } from '../src/types.ts';
import type { Checkout } from '../src/world/checkout.ts';

// The runner with a world and a display that start nothing: a folder with one log, and a screen
// that answers a few bytes.
let worldDir = '';
vi.mock('../src/world/local.ts', () => ({
  LocalWorld: {
    start: async () => ({ dir: worldDir, logs: worldDir, scanPaths: () => [worldDir], stop: async () => {} }),
  },
}));
vi.mock('../src/drivers/display.ts', () => ({
  Display: { start: async () => ({ screenshot: () => Buffer.from('png'), stop: async () => {} }) },
}));

const { runScenarios } = await import('../src/runner.ts');

const WORDS = 'member tenant urban tray rebel arrive hill review forest rifle close pear'.split(' ');
const PASSPHRASE = 'a long passphrase for the run';

function scenario(id: string, run: Scenario['run']): Scenario {
  return {
    meta: { id, title: id, proves: ['it'], platforms: ['desktop-linux'], worlds: ['local'], cadence: ['nightly'] },
    state: { state: 'on' },
    run,
  };
}

async function runOne(s: Scenario, out = mkdtempSync(join(tmpdir(), 'acceptance-report-'))) {
  const printed: ScenarioResult[] = [];
  const summary = await runScenarios([s], { checkout: {} as Checkout, out, onResult: (r) => printed.push(r) });
  const published = [
    readFileSync(join(out, 'report.json'), 'utf8'),
    readFileSync(join(out, 'summary.md'), 'utf8'),
    JSON.stringify(printed),
  ].join('\n');
  return { out, result: summary.results[0], published };
}

beforeEach(() => {
  worldDir = mkdtempSync(join(tmpdir(), 'acceptance-world-'));
  writeFileSync(join(worldDir, 'app.log'), 'started\n');
});

describe('what the runner publishes', () => {
  it('keeps no screen text from the failure of a step that shows a secret', async () => {
    const { result, published } = await runOne(
      scenario('words', async (ctx) => {
        ctx.worldBuilt();
        await ctx.step(
          'the words',
          [],
          async () => {
            // The words are on screen before the scenario has read them into the ledger.
            throw new Error(
              `waited 30 s for "I wrote them down"; last answer: false\nthe window shows:\n${WORDS.map((w, i) => `${i + 1}\n${w}`).join('\n')}`,
            );
          },
          { shows: 'the 12 words' },
        );
      }),
    );
    expect(result.outcome).toBe('failed');
    expect(result.steps[0].error).toContain('the screen showed the 12 words');
    for (const word of WORDS) expect(published).not.toMatch(new RegExp(`\\b${word}\\b`));
  });

  it('redacts a recorded secret from a failure, the 12 words word by word', async () => {
    const { result, published } = await runOne(
      scenario('redact', async (ctx) => {
        ctx.worldBuilt();
        ctx.secrets.add('passphrase', 'the custody passphrase', PASSPHRASE);
        ctx.secrets.addWords('the 12 words', WORDS);
        await ctx.step('a later step', [], async () => {
          throw new Error(`the field holds ${PASSPHRASE}; the window shows:\n1\n${WORDS[0]}\n2\n${WORDS[1]}`);
        });
      }),
    );
    expect(result.reason).toContain('[the custody passphrase]');
    expect(result.reason).toContain('[the 12 words]');
    expect(published).not.toContain(PASSPHRASE);
    for (const word of WORDS) expect(published).not.toMatch(new RegExp(`\\b${word}\\b`));
  });

  it('does not keep a report artefact that holds a secret, and says where it was', async () => {
    const out = mkdtempSync(join(tmpdir(), 'acceptance-report-'));
    const dir = join(out, 'artefact');
    const { result } = await runOne(
      scenario('artefact', async (ctx) => {
        ctx.worldBuilt();
        ctx.secrets.add('passphrase', 'the custody passphrase', PASSPHRASE);
        await ctx.step('a step', [], async () => {});
        // A step's kept text that shows the passphrase.
        writeFileSync(join(dir, 'leak.txt'), `typed ${PASSPHRASE}`);
      }),
      out,
    );
    expect(result.outcome).toBe('failed');
    expect(result.reason).toContain('the custody passphrase');
    expect(existsSync(join(dir, 'leak.txt'))).toBe(false);
    const scan = JSON.parse(readFileSync(join(dir, 'scan.json'), 'utf8'));
    expect(scan.withheld).toEqual([join(dir, 'leak.txt')]);
    for (const file of readdirSync(dir)) expect(readFileSync(join(dir, file), 'utf8')).not.toContain(PASSPHRASE);
  });

  it("removes the world's folder after a passing scenario and keeps it after a failing one", async () => {
    const passed = await runOne(
      scenario('passes', async (ctx) => {
        ctx.worldBuilt();
        await ctx.step('a step', [], async () => {});
      }),
    );
    expect(passed.result.outcome).toBe('passed');
    expect(existsSync(worldDir)).toBe(false);

    worldDir = mkdtempSync(join(tmpdir(), 'acceptance-world-'));
    writeFileSync(join(worldDir, 'app.log'), 'started\n');
    const failed = await runOne(
      scenario('fails', async (ctx) => {
        ctx.worldBuilt();
        await ctx.step('a step', [], async () => {
          throw new Error('no');
        });
      }),
    );
    expect(failed.result.outcome).toBe('failed');
    expect(existsSync(worldDir)).toBe(true);
    expect(readFileSync(join(failed.out, 'fails', 'notes.txt'), 'utf8')).toContain(worldDir);
  });
});
