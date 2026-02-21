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

/** Run a single named assertion and capture pass/fail + duration. */
export async function test(name: string, fn: () => void | Promise<void>): Promise<TestResult> {
  const start = Date.now();
  try {
    await fn();
    return { name, passed: true, durationMs: Date.now() - start };
  } catch (e) {
    return {
      name,
      passed: false,
      error: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - start,
    };
  }
}

/** Lightweight assertion used inside test() callbacks. */
export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
