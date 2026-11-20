/**
 * The GPUI shell's identity window: the shared window (`@we/identity-window`) over the four
 * `identity_flow_*` commands, which the shell accepts only from this window's label.
 */
import { runIdentityWindow, type Screen, type StepInput } from '@we/identity-window';

import { invoke } from '../src/platform/bridge';

runIdentityWindow({
  start: () => invoke<Screen>('identity_flow_start'),
  step: (input: StepInput) => invoke<Screen>('identity_flow_step', { input }),
  cancel: () => invoke<void>('identity_flow_cancel'),
  finish: () => invoke<void>('identity_flow_finish'),
});
