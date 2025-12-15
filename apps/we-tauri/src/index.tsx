/* @refresh reload */
import { render } from 'solid-js/web';
import { App, PlatformProvider } from '@we/app-framework/solid';
import { tauriAdapter } from './platform/tauriAdapter';

// Import global styles from app-framework
import '@we/app-framework/shared/index.scss';

const root = document.getElementById('root');

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  console.error('Root element not found. Did you forget to add it to your index.html?');
}

render(
  () => (
    <PlatformProvider adapter={tauriAdapter}>
      <App />
    </PlatformProvider>
  ),
  root!
);
