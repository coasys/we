/**
 * A scenario: what it says about itself (`meta`), whether it runs (`state`), the steps it names but
 * cannot take yet (`pendingSteps`), and what it does (`run`).
 *
 * A scenario is `pending` until the commit that makes it pass lands, and says why. The commit that
 * makes it pass turns it `on` in the same change.
 *
 * A scenario acts as a person, through the apps: `ctx.step` runs one step and keeps what the person
 * saw after it. World building comes first and ends with `ctx.worldBuilt()`; after that the only
 * executor calls a scenario may make are reads for its assertions (`test/rules.test.ts` checks this).
 */
import type { DesktopApp, LaunchOptions } from './drivers/desktop.ts';
import type { Display } from './drivers/display.ts';
import type { Allowance, SecretLedger } from './secrets.ts';
import type { PendingStep, ScenarioMeta, ScenarioState } from './types.ts';
import type { LocalWorld } from './world/local.ts';

export interface StepOptions {
  /**
   * The step leaves a secret on screen on purpose (the words screen): its screenshot and text are
   * withheld, and the report says which secret they showed.
   */
  shows?: string;
}

export interface ScenarioContext {
  world: LocalWorld;
  display: Display;
  secrets: SecretLedger;
  /** Runs one step. A failure names the step and the requirements it checks. */
  step(name: string, checks: string[], run: () => Promise<void>, options?: StepOptions): Promise<void>;
  /** Starts the desktop app's harness build. */
  launchDesktop(options: LaunchOptions): Promise<DesktopApp>;
  /** Marks the end of world building. */
  worldBuilt(): void;
  /** A place where a recorded secret may be found, and the requirement that allows it. */
  allow(allowance: Allowance): void;
  /** A line in the scenario's log. */
  note(message: string): void;
}

export interface Scenario {
  meta: ScenarioMeta;
  state: ScenarioState;
  /** Steps the scenario names that later work adds, with the reason. */
  pendingSteps?: PendingStep[];
  run?(ctx: ScenarioContext): Promise<void>;
}

/** Declares a scenario. An `on` scenario must have a `run`. */
export function defineScenario(scenario: Scenario): Scenario {
  if (scenario.state.state === 'on' && !scenario.run) {
    throw new Error(`${scenario.meta.id} is on but has nothing to run`);
  }
  if (scenario.state.state === 'pending' && !scenario.state.reason.trim()) {
    throw new Error(`${scenario.meta.id} is pending without a reason`);
  }
  return scenario;
}

/** Fails a step with a message, when a condition does not hold. */
export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
