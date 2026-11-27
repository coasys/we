/**
 * The dock layout's recorded vectors — what a second host implements the layout against — replayed
 * against the kernel, so a change that alters an answer fails here until the vectors are recorded
 * again (`pnpm --filter @we/app-shell record:kernels`) and the diff is reviewed as the behaviour change
 * it is. And the list itself: every entry point the kernel names is asked, and every question names
 * an entry point the kernel still has.
 *
 * The helpers behind the entry points are tested in `dockGeometry.test.ts`, not here.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { askScenario, type DockAsk, type DockScenario } from '../scripts/dockLayoutCases';
import * as dockLayout from '../src/shared/kernels/dockLayout';

type Recorded = Omit<DockScenario, 'asks'> & { asks: (DockAsk & { output: unknown })[] };

const scenarios = JSON.parse(
  readFileSync(new URL('../src/shared/kernels/vectors/dockLayout.json', import.meta.url), 'utf8'),
) as Recorded[];
const kernel = dockLayout as unknown as Record<string, (...args: unknown[]) => unknown>;
const asks = scenarios.flatMap((scenario) => scenario.asks);
const askName = (ask: DockAsk) => ask.name ?? ask.as ?? ask.fn;

describe('the dock layout kernel', () => {
  it('has vectors for every function it names, and names every function a vector asks', () => {
    const named = Object.keys(kernel).sort();
    const asked = [...new Set(asks.map((ask) => ask.fn))].sort();
    expect(asked).toEqual(named);
  });

  it('has no two scenarios of the same name, and no two questions of the same name in one', () => {
    const repeated = (names: string[]) => names.filter((name, index) => names.indexOf(name) !== index);
    expect(repeated(scenarios.map((scenario) => scenario.name))).toEqual([]);
    for (const scenario of scenarios) expect(repeated(scenario.asks.map(askName)), scenario.name).toEqual([]);
  });
});

describe('the recorded vectors', () => {
  it.each(scenarios.map((scenario) => [scenario.name, scenario] as const))('%s', (_name, scenario) => {
    const answers = askScenario(scenario, (fn, args) => kernel[fn](...args)).map((answer) =>
      answer === undefined ? null : (JSON.parse(JSON.stringify(answer)) as unknown),
    );
    scenario.asks.forEach((ask, index) => expect(answers[index], askName(ask)).toEqual(ask.output));
  });
});
