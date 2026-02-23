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
