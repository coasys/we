/**
 * The Tauri app's identity window: the shared window (`@coasys/identity-portal`) over the four
 * `identity_flow_*` commands, which only this window's capability grants.
 */
import { runIdentityWindow, type Screen, type StepInput } from '@coasys/identity-portal';
import { invoke } from '@tauri-apps/api/core';

runIdentityWindow({
  start: () => invoke<Screen>('identity_flow_start'),
  step: (input: StepInput) => invoke<Screen>('identity_flow_step', { input }),
  cancel: () => invoke<Screen | null>('identity_flow_cancel'),
  finish: () => invoke<void>('identity_flow_finish'),
});
