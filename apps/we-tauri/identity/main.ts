/**
 * The Tauri app's identity window: the shared window (`@we/identity-window`) over the four
 * `identity_flow_*` commands, which only this window's capability grants.
 */
import { invoke } from '@tauri-apps/api/core';
import { runIdentityWindow, type Screen, type StepInput } from '@we/identity-window';

runIdentityWindow({
  start: () => invoke<Screen>('identity_flow_start'),
  step: (input: StepInput) => invoke<Screen>('identity_flow_step', { input }),
  cancel: () => invoke<void>('identity_flow_cancel'),
  finish: () => invoke<void>('identity_flow_finish'),
});
