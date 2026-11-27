/**
 * Scenarios the desktop app cannot pass yet. Each says what it needs; the change that adds it turns
 * the scenario on and gives it its steps.
 */
import { defineScenario } from '../scenario.ts';
import type { ScenarioMeta } from '../types.ts';

const desktop: Pick<ScenarioMeta, 'platforms' | 'worlds' | 'cadence'> = {
  platforms: ['desktop-linux'],
  worlds: ['local'],
  cadence: ['nightly'],
};

export const PENDING = [
  defineScenario({
    meta: {
      id: 'start-now-then-identity',
      title: '"Start now", then make the identity later and claim what this computer did before',
      proves: ['Posts made before the identity show under the person once it exists.'],
      ...desktop,
    },
    state: { state: 'pending', reason: 'needs the incept that lists an older device key, which a later change adds' },
  }),
  defineScenario({
    meta: {
      id: 'link-a-second-desktop',
      title: 'Link a second desktop by a link it opens, then it joins a space as the same person',
      proves: ['A second desktop joins the identity by a link, with no short code and no secret in the main window.'],
      ...desktop,
    },
    state: {
      state: 'pending',
      reason: 'needs `coasys://link` deep links and the identity window’s link-from-app step',
    },
  }),
  defineScenario({
    meta: {
      id: 'link-a-phone',
      title: 'Link a phone by QR code; the phone keeps the master key',
      proves: ['A phone joins by the QR code the desktop shows, and can keep the master key.'],
      platforms: ['desktop-linux', 'phone-android'],
      worlds: ['local'],
      cadence: ['nightly'],
    },
    state: { state: 'pending', reason: 'needs the phone app and its driver' },
  }),
  defineScenario({
    meta: {
      id: 'restore-with-words',
      title: 'Every device lost: restore with the 12 words on a fresh desktop',
      proves: ['The 12 words bring the identity back with a new master key.'],
      ...desktop,
    },
    state: { state: 'pending', reason: 'needs "Use my 12 words", which a later change adds' },
  }),
  defineScenario({
    meta: {
      id: 'replace-the-master-key',
      title: 'Replace the master key; the other holders take the new one',
      proves: ['A rotation reaches every device that holds the master key.'],
      ...desktop,
    },
    state: { state: 'pending', reason: 'needs master key rotation, which a later change adds' },
  }),
  defineScenario({
    meta: {
      id: 'log-out-only-copy',
      title: 'Log out with the only copy of the master key',
      proves: ['Log out never removes the only copy of the master key.'],
      ...desktop,
    },
    state: { state: 'pending', reason: 'needs the log-out choices for the master key, which a later change adds' },
  }),
];
