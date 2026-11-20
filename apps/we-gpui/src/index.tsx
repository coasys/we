/* @refresh reload */
import '@we/app-shell/shared/index.scss';

import { App, PlatformProvider } from '@we/app-shell/solid';
import weSeed from '@we/seed-file';
import { render } from 'solid-js/web';

import { ad4mConnector } from './platform/ad4mConnector';
import { gpuiPlatform } from './platform/gpuiPlatform';

const root = document.getElementById('root');

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  console.error('Root element not found. Did you forget to add it to your index.html?');
}

render(
  () => (
    <PlatformProvider seed={weSeed} platform={gpuiPlatform} backend={ad4mConnector}>
      <App />
    </PlatformProvider>
  ),
  root!,
);
