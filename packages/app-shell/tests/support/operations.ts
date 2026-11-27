/**
 * The declared-operation runner a test's stores run on — one composition's queues, speculations and
 * predictions, as `composeStores` makes them — bound to the entity stand-ins as the composition binds
 * its own, so a store's reads through `@we/entities` draw what the runner predicted.
 *
 * One per test file (vitest gives each file its own modules); a test clears the predictions between
 * cases with `testPredictions.clear()`. A test about two compositions makes its own with
 * `createOperations`.
 */
import { bindPredictions } from '@we/entities';

import { createOperations } from '../../src/shared/invokeOperation';

export const testOperations = createOperations();
export const testPredictions = testOperations.predictions;
bindPredictions(testPredictions);
