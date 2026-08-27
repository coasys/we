/* @refresh reload */
// Import global styles from app-shell
import '@we/app-shell/shared/index.scss';

import { App, PlatformProvider, type WeSeedFile } from '@we/app-shell/solid';
import { render } from 'solid-js/web';

import weSeed from '../../../we-seed.json';
import { ad4mConnector } from './platform/ad4mConnector';
import { createGuestConnector, parseGuestParams } from './platform/guestConnector';
import { webPlatform } from './platform/webPlatform';

// Detect a guest invite URL before anything renders.
// `/join/<spaceId>?host=<hostUrl>` → guest connector, auto-join after auth.
const guestTarget = parseGuestParams();
const connector = guestTarget ? createGuestConnector(guestTarget.hostUrl) : ad4mConnector;

// The boot controller reads this to auto-join the target space after auth completes.
// Stored here rather than in a store because it must survive the entire provider tree mount.
if (guestTarget) {
  (window as unknown as { __weGuestJoinTarget: string }).__weGuestJoinTarget = guestTarget.spaceId;
}

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
