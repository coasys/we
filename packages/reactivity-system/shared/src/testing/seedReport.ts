/**
 * Says which seed the test ports shuffled by when a test that made one fails, so the failure can be
 * run again in the same order (`WE_REACTIVITY_SEED=<seed>`). Call it from a vitest setup file.
 */
import { beforeEach } from 'vitest';

import { TEST_REACTIVITY_SEED, testPortsMade } from './port';

export function reportTestReactivitySeed(): void {
  beforeEach((context) => {
    const before = testPortsMade();
    context.onTestFailed(() => {
      if (testPortsMade() === before) return;
      console.error(
        `The test reactivity port ran sibling effects shuffled by seed ${TEST_REACTIVITY_SEED}. ` +
          `Run again with WE_REACTIVITY_SEED=${TEST_REACTIVITY_SEED} for the same order.`,
      );
    });
  });
}
