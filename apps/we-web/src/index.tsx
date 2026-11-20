/* @refresh reload */

// First, so it is in place before anything that might reach for it. See the module's own note on
// why this cannot be written inline here.
import './platform/randomUuidPolyfill';
// Import global styles from app-shell
import '@we/app-shell/shared/index.scss';

import { writeGuestBootTarget } from '@we/app-shell/shared';
import { App, PlatformProvider } from '@we/app-shell/solid';
import weSeed from '@we/seed-file';
import { render } from 'solid-js/web';

import { ad4mConnector } from './platform/ad4mConnector';
import { createSessionConnector, takeBootSession } from './platform/bootSession';
import { createGuestConnector, parseGuestParams, storedGuestHost } from './platform/guestConnector';
import { webPlatform } from './platform/webPlatform';

// Detect a guest invite URL before anything renders.
// `/join/<spaceId>?host=<hostUrl>` → guest connector, auto-join after auth.
const guestTarget = parseGuestParams();

/*
  Three ways in, in this order.

  1. A host that embeds WE hands it a session (`window.__WE_AD4M_SESSION`, see `bootSession.ts`):
     the person is already signed in there, and a guest link in the same page does not replace it —
     it takes them to the space's join gate, as an ordinary share link does.
  2. A guest link, or a tab that came in by one and was reloaded: the guest connector, with an
     account made for the link. A guest link is for somebody who has no account.
  3. Otherwise the browser links itself through Coasys Connect: the frame on the auth domain, where
     the person picks one of their own devices. The token stays in this page's memory.

  The phone app's key login is the Coasys base app's (`apps/coasys`), not this entry's.
*/
const bootSession = takeBootSession();
const guestHost = bootSession ? null : (guestTarget?.hostUrl ?? storedGuestHost());
const connector = bootSession
  ? createSessionConnector(bootSession)
  : guestHost
    ? createGuestConnector(guestHost)
    : ad4mConnector;

// The boot controller reads this to reach the target space once auth completes. Stored on the
// global rather than in a store because it must survive the entire provider tree mounting.
if (guestTarget) writeGuestBootTarget({ spaceId: guestTarget.spaceId, autoJoin: !bootSession });

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
