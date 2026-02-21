import type { PerspectiveProxy } from '@coasys/ad4m';

export type TestResult = {
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
};

export type ScenarioModule = {
  name: string;
  run: (perspective: PerspectiveProxy) => Promise<TestResult[]>;
};

/** Produce a stub result for a not-yet-implemented test. */
export function stub(name: string): TestResult {
  return { name, passed: false, error: 'Not yet implemented', durationMs: 0 };
}
