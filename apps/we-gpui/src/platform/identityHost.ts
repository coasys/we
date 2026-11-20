/**
 * The app window's side of the custody service, as the Tauri app's: open the identity window on a
 * step (`identity_open`), read public custody state (`identity_public_state`), and hear how a step
 * ended (`identity-step-done`). No word, passphrase, key or offer link comes this way.
 */
import type { Ad4mCustodyHost, Ad4mCustodyState } from '@we/backend-ad4m';

import { invoke, listen } from './bridge';

type IdentityChange = Parameters<Ad4mCustodyHost['open']>[0];
type IdentityChangeOutcome = Awaited<ReturnType<Ad4mCustodyHost['open']>>;

interface StepDone {
  step: string;
  outcome: IdentityChangeOutcome;
}

export const gpuiIdentityHost: Ad4mCustodyHost = {
  async open(step: IdentityChange): Promise<IdentityChangeOutcome> {
    // Listen first, so a window that ends at once cannot finish before anyone is listening.
    let resolve!: (outcome: IdentityChangeOutcome) => void;
    const done = new Promise<IdentityChangeOutcome>((r) => (resolve = r));
    const unlisten = listen<StepDone>('identity-step-done', (event) => resolve(event.payload.outcome));
    try {
      const { opened } = await invoke<{ opened: boolean }>('identity_open', { step });
      // A window already open runs its own step; this call did not start one.
      if (!opened) return 'cancelled';
      return await done;
    } finally {
      unlisten();
    }
  },

  publicState: () => invoke<Ad4mCustodyState>('identity_public_state'),
};
