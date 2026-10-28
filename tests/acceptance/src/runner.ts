/**
 * Runs scenarios, each in a fresh local world, and says of each: passed, failed or pending.
 *
 * For each scenario that is on: a new world and X display; the steps, with a screenshot and the
 * window text after each; the apps and the world stopped, and checked stopped; then the scan of
 * everything the scenario touched for every secret it recorded. A failed step, a world that leaves a
 * process behind, or a secret where it must not be: each fails the scenario, and says why.
 *
 * A scenario does not rerun after a failure.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DesktopApp } from './drivers/desktop.ts';
import { Display } from './drivers/display.ts';
import type { Scenario, ScenarioContext } from './scenario.ts';
import { type Allowance, SecretLedger } from './secrets.ts';
import type { RunSummary, ScenarioResult, StepResult } from './types.ts';
import type { Checkout } from './world/checkout.ts';
import { LocalWorld } from './world/local.ts';

export interface RunOptions {
  checkout: Checkout;
  /** Where the report and each step's screenshot go. */
  out: string;
  /** Called as each scenario ends. */
  onResult?: (result: ScenarioResult) => void;
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

export async function runScenarios(scenarios: Scenario[], options: RunOptions): Promise<RunSummary> {
  mkdirSync(options.out, { recursive: true });
  const summary: RunSummary = { startedAt: new Date().toISOString(), results: [], passed: 0, failed: 0, pending: 0 };
  for (const scenario of scenarios) {
    const result = scenario.state.state === 'pending' ? pendingResult(scenario) : await runOne(scenario, options);
    summary.results.push(result);
    summary[result.outcome] += 1;
    options.onResult?.(result);
    writeReport(summary, options.out);
  }
  return summary;
}

function pendingResult(scenario: Scenario): ScenarioResult {
  return {
    id: scenario.meta.id,
    title: scenario.meta.title,
    outcome: 'pending',
    passed: false,
    reason: scenario.state.state === 'pending' ? scenario.state.reason : undefined,
    steps: [],
    pendingSteps: scenario.pendingSteps ?? [],
    findings: [],
    scanned: { files: 0, bytes: 0 },
    ms: 0,
  };
}

async function runOne(scenario: Scenario, options: RunOptions): Promise<ScenarioResult> {
  const started = Date.now();
  const dir = join(options.out, scenario.meta.id);
  mkdirSync(dir, { recursive: true });
  const notes: string[] = [];
  const steps: StepResult[] = [];
  const secrets = new SecretLedger();
  const allowances: Allowance[] = [];
  const apps: DesktopApp[] = [];
  let failure: string | undefined;
  let world: LocalWorld | undefined;
  let display: Display | undefined;
  let built = false;

  try {
    world = await LocalWorld.start(options.checkout);
    // In the world's folder: the framebuffer is a raw image the size of the screen, not a report.
    display = await Display.start(join(world.dir, 'display'), world.logs);
    const w = world;
    const d = display;
    const ctx: ScenarioContext = {
      world: w,
      display: d,
      secrets,
      note: (message) => notes.push(`${new Date().toISOString()} ${message}`),
      allow: (allowance) => allowances.push(allowance),
      worldBuilt: () => {
        built = true;
      },
      launchDesktop: async (launch) => {
        const app = await DesktopApp.launch(w, d, launch);
        apps.push(app);
        return app;
      },
      step: async (name, checks, run, stepOptions = {}) => {
        if (!built) throw new Error(`step "${name}" before ctx.worldBuilt(): build the world first`);
        const begun = Date.now();
        const step: StepResult = { name, checks, passed: false, ms: 0 };
        steps.push(step);
        try {
          await run();
          step.passed = true;
        } catch (error) {
          step.error = error instanceof Error ? error.message : String(error);
          throw new StepFailure(name, checks, step.error);
        } finally {
          step.ms = Date.now() - begun;
          await keepScreen(step, steps.length, dir, d, apps, stepOptions.shows);
        }
      },
    };
    await scenario.run!(ctx);
  } catch (error) {
    failure =
      error instanceof StepFailure
        ? `step "${error.step}" failed (${error.checks.join(', ') || 'no requirement named'}): ${error.message}`
        : `the scenario stopped before its steps finished: ${error instanceof Error ? error.message : String(error)}`;
  }

  for (const app of apps) await app.stop().catch((e) => notes.push(`stopping ${app.name}: ${e}`));
  if (world) {
    try {
      await world.stop();
    } catch (error) {
      failure ??= `the world did not stop cleanly: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  await display?.stop();
  writeFileSync(join(dir, 'notes.txt'), notes.join('\n'));

  // Everything the scenario touched: the world's logs and data folders, and the report artefacts.
  const scan = await secrets.scan([...(world ? world.scanPaths() : []), dir], allowances);
  writeFileSync(join(dir, 'scan.json'), JSON.stringify({ secrets: secrets.labels(), ...scan }, null, 2));
  if (scan.findings.length && !failure) {
    const first = scan.findings[0];
    failure = `the secret "${first.label}" (${first.kind}) was found in ${first.where} at byte ${first.offset}${
      scan.findings.length > 1 ? `, and ${scan.findings.length - 1} more (scan.json)` : ''
    }`;
  }
  if (!failure && scan.files === 0) failure = 'the scan read no file, so it proves nothing';

  return {
    id: scenario.meta.id,
    title: scenario.meta.title,
    outcome: failure ? 'failed' : 'passed',
    passed: !failure,
    reason: failure,
    steps,
    pendingSteps: scenario.pendingSteps ?? [],
    findings: scan.findings,
    scanned: { files: scan.files, bytes: scan.bytes },
    ms: Date.now() - started,
  };
}

class StepFailure extends Error {
  constructor(
    readonly step: string,
    readonly checks: string[],
    message: string,
  ) {
    super(message);
  }
}

/** Keeps what the person saw after a step, or says which secret it showed and keeps nothing. */
async function keepScreen(
  step: StepResult,
  n: number,
  dir: string,
  display: Display,
  apps: DesktopApp[],
  shows?: string,
) {
  if (shows) {
    step.withheld = `the screen showed ${shows}`;
    return;
  }
  const base = `${String(n).padStart(2, '0')}-${slug(step.name)}`;
  try {
    writeFileSync(join(dir, `${base}.png`), display.screenshot());
    step.screenshot = `${base}.png`;
  } catch (error) {
    step.error ??= `no screenshot: ${error instanceof Error ? error.message : String(error)}`;
  }
  const texts: string[] = [];
  for (const app of apps) {
    try {
      const { windows } = await app.state();
      for (const { label } of windows) {
        if (label !== 'main' && label !== 'identity') continue;
        texts.push(`── ${app.name} · ${label} ──\n${await app.text(label)}`);
      }
    } catch {
      // The app has gone (a step that stops it): no text to keep.
    }
  }
  if (texts.length) {
    writeFileSync(join(dir, `${base}.txt`), texts.join('\n\n'));
    step.text = `${base}.txt`;
  }
}

function writeReport(summary: RunSummary, out: string) {
  writeFileSync(join(out, 'report.json'), JSON.stringify(summary, null, 2));
  const lines = [
    `# Acceptance run ${summary.startedAt}`,
    '',
    `${summary.passed} passed · ${summary.failed} failed · ${summary.pending} pending`,
    '',
    '| Scenario | Outcome | Why |',
    '|---|---|---|',
    ...summary.results.map(
      (r) =>
        `| ${r.id} ${r.title} | ${r.outcome} | ${(r.reason ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 300)} |`,
    ),
    '',
  ];
  for (const r of summary.results) {
    if (!r.steps.length && !r.pendingSteps.length) continue;
    lines.push(`## ${r.id} · ${r.outcome}`, '');
    for (const s of r.steps) {
      const seen = s.withheld
        ? ` (not kept: ${s.withheld})`
        : s.screenshot
          ? ` ([screen](${r.id}/${s.screenshot}))`
          : '';
      lines.push(
        `- ${s.passed ? 'passed' : 'FAILED'}: ${s.name}${s.checks.length ? ` — ${s.checks.join(', ')}` : ''}${seen}`,
      );
      if (s.error) lines.push(`  - ${s.error.split('\n')[0]}`);
    }
    for (const p of r.pendingSteps) lines.push(`- pending: ${p.step} — ${p.reason}`);
    lines.push(`- scanned ${r.scanned.files} files (${r.scanned.bytes} bytes); findings: ${r.findings.length}`, '');
  }
  writeFileSync(join(out, 'summary.md'), lines.join('\n'));
}
