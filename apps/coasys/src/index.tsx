/* @refresh reload */

/*
  The Coasys app in a browser and in the phone app: the cartridge before a session, drawn with no
  backend at all, then WE's app in the same page once a connection is chosen (`BaseBoot`).

  Which host it is decides what the base app can ask. Inside the phone app the `DeviceKey` plugin is
  there, so the identity is the phone's and a session can be had with its device key; anywhere else it
  is a browser, which keeps no identity and links itself through Coasys Connect. The desktop shells render
  the same `BaseBoot` from their own entries, with the desktop host (`./hosts/desktop`).
*/

// First, so it is in place before anything that might reach for it: see the module's own note.
import '@we/app-web/platform/randomUuidPolyfill';
import '@we/app-shell/shared/index.scss';

import { writeGuestBootTarget } from '@we/app-shell/shared';
import { App, BaseBoot, PlatformProvider } from '@we/app-shell/solid';
import { ad4mConnector } from '@we/app-web/platform/ad4mConnector';
import { deviceKeyPlugin } from '@we/app-web/platform/deviceKey';
import { createGuestConnector, parseGuestParams, storedGuestHost } from '@we/app-web/platform/guestConnector';
import { webPlatform } from '@we/app-web/platform/webPlatform';
import weSeed from '@we/seed-file';
import { render } from 'solid-js/web';

import { chooseHost } from './hosts/choose';

const root = document.getElementById('root');
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  console.error('Root element not found. Did you forget to add it to your index.html?');
}

/*
  A guest link is for somebody with no account, and boots as it does in WE's web app: straight to the
  guest connector, with nothing asked first; so does a reload of a tab that came in by one (see
  apps/we-web/src/index.tsx).
*/
const guestTarget = parseGuestParams();
const guestHost = guestTarget?.hostUrl ?? storedGuestHost();
if (guestTarget) writeGuestBootTarget({ spaceId: guestTarget.spaceId, autoJoin: true });

if (guestHost) {
  const guest = createGuestConnector(guestHost);
  render(
    () => (
      <PlatformProvider seed={weSeed} platform={webPlatform} backend={guest}>
        <App />
      </PlatformProvider>
    ),
    root!,
  );
} else {
  const host = chooseHost({ plugin: deviceKeyPlugin(), fallback: ad4mConnector });
  render(() => <BaseBoot host={host} platform={webPlatform} seed={weSeed} />, root!);
}
