/* @refresh reload */
/*
  The desktop app on Tauri: the app before a session first (`BaseBoot`), then WE's app in the same
  window once a connection is chosen — the same host as Electron's (`@we/app-coasys/hosts/desktop`),
  with the identity read through the `identity_*` commands. Tauri runs its executor in-process and
  reports no start of its own, so the base app passes no executor state here. See apps/coasys/README.md.
*/
// Import global styles from app-shell
import '@we/app-shell/shared/index.scss';

import { desktopBaseHost } from '@we/app-coasys/hosts/desktop';
import { BaseBoot } from '@we/app-shell/solid';
import weSeed from '@we/seed-file';
import { render } from 'solid-js/web';

import { ad4mConnector } from './platform/ad4mConnector';
import { tauriIdentityHost } from './platform/identityHost';
import { tauriPlatform } from './platform/tauriPlatform';

const root = document.getElementById('root');

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  console.error('Root element not found. Did you forget to add it to your index.html?');
}

const host = desktopBaseHost({ custody: tauriIdentityHost, local: ad4mConnector });

render(() => <BaseBoot host={host} platform={tauriPlatform} seed={weSeed} />, root!);
