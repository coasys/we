/* @refresh reload */
/*
  The desktop app: the app before a session first (`BaseBoot`), then WE's app in the same window once a
  connection is chosen.

  The window opens before the executor is up, so the base app is what it draws while the executor
  starts, and what it draws if it does not: the identity (through the custody sidecar's window), the
  choice of where the session comes from, and the executor's failure with a way to try again. See
  apps/coasys/README.md.
*/
// Import global styles from app-shell
import '@we/app-shell/shared/index.scss';

import { bridgedExecutor, desktopBaseHost } from '@we/app-coasys/hosts/desktop';
import { BaseBoot } from '@we/app-shell/solid';
import weSeed from '@we/seed-file';
import { render } from 'solid-js/web';

import { ad4mConnector } from './platform/ad4mConnector';
import { electronPlatform } from './platform/electronPlatform';

const root = document.getElementById('root');

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  console.error('Root element not found. Did you forget to add it to your index.html?');
}

const bridge = window.electron;
const host = desktopBaseHost({
  custody: bridge?.custody,
  executor: bridge?.executor ? bridgedExecutor(bridge.executor) : undefined,
  local: ad4mConnector,
  servers: bridge?.servers,
});

render(() => <BaseBoot host={host} platform={electronPlatform} seed={weSeed} />, root!);
