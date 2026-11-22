/**
 * The Electron app's identity window: the shared window (`@coasys/identity-portal`) over the calls its
 * own preload exposes (`electron/identityPreload.js`), which the main process answers for this
 * window only.
 */
import { type IdentityTransport, runIdentityWindow } from '@coasys/identity-portal';

declare global {
  interface Window {
    identity: IdentityTransport;
  }
}

runIdentityWindow(window.identity);
