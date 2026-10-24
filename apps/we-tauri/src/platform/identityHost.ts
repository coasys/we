/**
 * The main window's side of the custody service: the Tauri host's `identity`.
 *
 * The main window may do two things and the capability allows no more: open the identity window on
 * a step (`identity_open`), and read public custody state (`identity_public_state`). How the step
 * ended arrives as the `identity-step-done` event when the identity window closes. No word,
 * passphrase, key or offer link ever comes this way.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { CustodyPublic, IdentityHost, IdentityStep, IdentityStepOutcome } from '@we/app-shell/shared';

interface StepDone {
  step: string;
  outcome: IdentityStepOutcome;
}

export const tauriIdentityHost: IdentityHost = {
  async open(step: IdentityStep): Promise<IdentityStepOutcome> {
    // Listen first, so a window that ends at once cannot finish before anyone is listening.
    let resolve!: (outcome: IdentityStepOutcome) => void;
    const done = new Promise<IdentityStepOutcome>((r) => (resolve = r));
    const unlisten = await listen<StepDone>('identity-step-done', (event) => resolve(event.payload.outcome));
    try {
      const { opened } = await invoke<{ opened: boolean }>('identity_open', { step });
      // A window already open runs its own step; this call did not start one.
      if (!opened) return 'cancelled';
      return await done;
    } finally {
      unlisten();
    }
  },

  publicState: () => invoke<CustodyPublic>('identity_public_state'),
};
