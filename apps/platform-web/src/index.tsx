/* @refresh reload */
// Import global styles from app-shell
import '@we/app-shell/shared/index.scss';

import { App, PlatformProvider, type WeSeedFile } from '@we/app-shell/solid';
import { render } from 'solid-js/web';

import platformSeed from '../../../platform-seed.json';
import { platformConnector } from './platform/platformConnector';
import { webPlatform } from './platform/webPlatform';

const root = document.getElementById('root');

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  console.error('Root element not found. Did you forget to add it to your index.html?');
}

render(
  () => (
    <PlatformProvider seed={platformSeed as unknown as WeSeedFile} platform={webPlatform} backend={platformConnector}>
      <App />
    </PlatformProvider>
  ),
  root!,
);
