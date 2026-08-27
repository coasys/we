/* @refresh reload */

// First, so it is in place before anything that might reach for it. See the module's own note on
// why this cannot be written inline here.
import './platform/randomUuidPolyfill';
// Import global styles from app-shell
import '@we/app-shell/shared/index.scss';

import { writeGuestBootTarget } from '@we/app-shell/shared';
import { App, PlatformProvider, type WeSeedFile } from '@we/app-shell/solid';
import { render } from 'solid-js/web';

import weSeed from '../../../we-seed.json';
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

// The boot controller reads this to reach the target space once auth completes. Stored on the
// global rather than in a store because it must survive the entire provider tree mounting.
if (guestTarget) writeGuestBootTarget({ spaceId: guestTarget.spaceId, autoJoin: !storedSession });

const root = document.getElementById('root');

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  console.error('Root element not found. Did you forget to add it to your index.html?');
}

render(
  () => (
    <PlatformProvider seed={weSeed as unknown as WeSeedFile} platform={webPlatform} backend={connector}>
      <App />
    </PlatformProvider>
  ),
  root!,
);
