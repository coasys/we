import './page.css';

import { startFrame } from './frame';
import { platformRegistry } from './registry';
import { StoreClient } from './store';
import { Screen } from './ui';

declare const __ENDPOINTS__: { platform: string; store: string; storeKey: string };

const root = document.getElementById('app');
if (!root) throw new Error('the page has no #app');
startFrame({
  self: window,
  // In a popup the app is the opener; in an iframe it is the parent.
  host: (window.opener as Window | null) ?? window.parent,
  screen: new Screen(root),
  registry: platformRegistry(__ENDPOINTS__.platform),
  store: new StoreClient(__ENDPOINTS__.store, __ENDPOINTS__.storeKey),
  hint: 'Browser',
});
