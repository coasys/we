/* @refresh reload */

// First, so it is in place before anything that might reach for it. See the module's own note on
// why this cannot be written inline here.
import './platform/randomUuidPolyfill';
// Import global styles from app-shell
import '@we/app-shell/shared/index.scss';

import { writeGuestBootTarget } from '@we/app-shell/shared';
import { App, PlatformProvider, registerHostChromeReserve } from '@we/app-shell/solid';
import weSeed from '@we/seed-file';
import { render } from 'solid-js/web';

import { ad4mConnector } from './platform/ad4mConnector';
import { createGuestConnector, hasStoredSession, parseGuestParams } from './platform/guestConnector';
import { webPlatform } from './platform/webPlatform';

// Detect a guest invite URL before anything renders.
// `/join/<spaceId>?host=<hostUrl>` → guest connector, auto-join after auth.
const guestTarget = parseGuestParams();

/*
  A guest link is for somebody who has no account, and it is only allowed to act like one for them.

  `connectAsGuest` writes the same localStorage keys every boot reads, so following it with a
  session already stored would swap that identity for a throwaway one — silently, from a link
  anybody can paste, with the original unreachable from inside the app afterwards. So an agent who
  already has a session keeps their own connector; the link then behaves as the ordinary share link
  does, taking them to the space's join gate to decide for themselves.
*/
const storedSession = hasStoredSession();
const connector = guestTarget && !storedSession ? createGuestConnector(guestTarget.hostUrl) : ad4mConnector;

/*
  `ad4m-connect` pins its settings button to the window's bottom-right corner (fixed, 34px at 10px
  in), and it is the only thing down there that no template declared. A floating panel knows
  nothing of it and resolves its bottom edge into the button's band, which is how a composer's send
  control ended up under the watermark. The corner is this host's own chrome, so the host publishes
  the reserve: the button's band plus a gap's worth of air around it. Only the full connector draws
  the button; a guest connects headless. Registered here rather than in `ad4mConnector`, which stays
  free of the Solid shell so it can be tested without a DOM.
*/
if (connector === ad4mConnector) registerHostChromeReserve('ad4m-connect', { bottom: 54 });

// The boot controller reads this to reach the target space once auth completes. Stored on the
// global rather than in a store because it must survive the entire provider tree mounting.
if (guestTarget) writeGuestBootTarget({ spaceId: guestTarget.spaceId, autoJoin: !storedSession });

const root = document.getElementById('root');

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  console.error('Root element not found. Did you forget to add it to your index.html?');
}

render(
  () => (
    <PlatformProvider seed={weSeed} platform={webPlatform} backend={connector}>
      <App />
    </PlatformProvider>
  ),
  root!,
);
