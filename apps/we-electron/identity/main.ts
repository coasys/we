/**
 * The Electron app's identity window: the shared window (`@we/identity-window`) over the calls its
 * own preload exposes (`electron/identityPreload.js`), which the main process answers for this
 * window only.
 */
import { type IdentityTransport, runIdentityWindow } from '@we/identity-window';

declare global {
  interface Window {
    identity: IdentityTransport;
  }
}

runIdentityWindow(window.identity);
