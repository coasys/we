/**
 * The words the acceptance world is written in: what a scenario says about itself, and what a run
 * says about a scenario.
 */

/** Which world a scenario runs in. There is no production world: tests never touch production. */
export type WorldKind = 'local' | 'staging';

/** Where a scenario runs. No Windows: the desktop app does not ship there. */
export type Platform =
  'desktop-linux' | 'desktop-macos' | 'phone-android' | 'phone-ios' | 'web-chromium' | 'web-firefox' | 'web-webkit';

/** When a scenario runs. */
export type Cadence = 'nightly' | 'weekly' | 'release-candidate' | 'before-opening' | 'manual-per-beta-build';

/** What a scenario says about itself. Every registered scenario carries one. */
export interface ScenarioMeta {
  /** A short name in kebab case: `make-an-identity`. Unique in the registry. */
  id: string;
  title: string;
  /** What it proves, one sentence each. A step's failure names the ones it checks. */
  proves: string[];
  platforms: Platform[];
  worlds: WorldKind[];
  cadence: Cadence[];
}

/**
 * A scenario's state in the registry.
 *
 * - `on`: it runs, and must pass.
 * - `pending`: the commit that makes it pass has not landed. It does not run; the report says why.
 */
export type ScenarioState = { state: 'on' } | { state: 'pending'; reason: string };

/** A step a scenario names but cannot take yet, with the reason. Reported, never run. */
export interface PendingStep {
  step: string;
  reason: string;
}

/** How one step went. */
export interface StepResult {
  name: string;
  /** What the step checks, in words. A failure names them. */
  checks: string[];
  passed: boolean;
  error?: string;
  ms: number;
  /** What the person saw after the step: a screenshot, and the window text beside it. */
  screenshot?: string;
  text?: string;
  /** Why the screen was not kept: it showed a secret on purpose. */
  withheld?: string;
}

export interface ScanFinding {
  label: string;
  kind: SecretKind;
  /** The file, and the byte offset in it. */
  where: string;
  offset: number;
}

export type ScenarioOutcome = 'passed' | 'failed' | 'pending';

/** One scenario's result. `passed` is hard: a scenario with a finding has not passed. */
export interface ScenarioResult {
  id: string;
  title: string;
  outcome: ScenarioOutcome;
  passed: boolean;
  /** Why a pending scenario does not run, or which step failed and what it checks. */
  reason?: string;
  steps: StepResult[];
  pendingSteps: PendingStep[];
  findings: ScanFinding[];
  /** What the scanner searched, so a clean scan can be told from an empty one. */
  scanned: { files: number; bytes: number };
  ms: number;
}

/** What a run of the scenarios found. */
export interface RunSummary {
  startedAt: string;
  results: ScenarioResult[];
  passed: number;
  failed: number;
  pending: number;
}

/** Every kind of secret a scenario can see. */
export type SecretKind =
  'words' | 'password' | 'passphrase' | 'offer-secret' | 'master-key' | 'admin-credential' | 'marker';
