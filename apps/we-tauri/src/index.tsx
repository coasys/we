/* @refresh reload */
// Import global styles from app-shell
import '@we/app-shell/shared/index.scss';

import { App, PlatformProvider } from '@we/app-shell/solid';
import { render } from 'solid-js/web';

import { ad4mConnector } from './platform/ad4mConnector';
import { tauriPlatform } from './platform/tauriPlatform';

const root = document.getElementById('root');

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  console.error('Root element not found. Did you forget to add it to your index.html?');
}

render(
  () => (
    <PlatformProvider platform={tauriPlatform} backend={ad4mConnector}>
      <App />
    </PlatformProvider>
  ),
  root!,
);
