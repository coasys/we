/* @refresh reload */

// Polyfill crypto.randomUUID for non-secure contexts (plain HTTP over LAN/Tailscale).
// crypto.getRandomValues works everywhere; only the randomUUID convenience method
// requires a secure context.
if (typeof crypto !== 'undefined' && !crypto.randomUUID) {
  crypto.randomUUID = () => {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    // Set version (4) and variant (RFC 4122) bits
    buf[6] = (buf[6] & 0x0f) | 0x40;
    buf[8] = (buf[8] & 0x3f) | 0x80;
    const hex = [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}

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
