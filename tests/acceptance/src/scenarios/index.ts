/** Every registered scenario, in the order a run takes them. */
import type { Scenario } from '../scenario.ts';
import addAndRevokeADevice from './addAndRevokeADevice.ts';
import makeAnIdentity, { withOsVault } from './makeAnIdentity.ts';
import { PENDING } from './pending.ts';

export const SCENARIOS: Scenario[] = [makeAnIdentity, withOsVault, addAndRevokeADevice, ...PENDING];
