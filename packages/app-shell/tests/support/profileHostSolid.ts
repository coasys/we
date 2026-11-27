/**
 * The profile vectors' host as the app is: Solid's port, the browser platform over jsdom's window,
 * and the app's own module-level host state, toasts and gates. See `profileHost.ts` for the runner;
 * this is the kit it runs the stores on in the app's own shape.
 */
import { toastService } from '@we/components/solid';
import { solidReactivity } from '@we/reactivity-solid';

import { credential } from '../../src/frameworks/solid/credential';
import { firstScreen } from '../../src/frameworks/solid/firstScreen';
import { shellHost, spaceHost } from '../../src/frameworks/solid/stores/hostState';
import { solidLiveTemplates } from '../../src/frameworks/solid/stores/liveTemplate';
import { createBrowserPlatform } from '../../src/shared/platform/browser';
import { asAdapter, type ProfileHostKit } from './profileHost';

/**
 * A small PNG, for the canvas jsdom does not have: what an image compressed for storage comes out
 * as. Which bytes it is does not reach the file (an image is compared as the fact of one).
 */
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/**
 * What jsdom leaves out of the browser and the stores use: an image that loads, a canvas that
 * encodes, and frames that never come — time does not pass in a case, so a playing clock is read
 * before it has moved.
 */
function provideBrowserGaps(): () => void {
  const image = window.HTMLImageElement.prototype;
  const srcDescriptor = Object.getOwnPropertyDescriptor(image, 'src');
  Object.defineProperty(image, 'src', {
    configurable: true,
    set(this: HTMLImageElement, value: string) {
      this.setAttribute('src', value);
      queueMicrotask(() => this.onload?.(new Event('load')));
    },
    get(this: HTMLImageElement) {
      return this.getAttribute('src') ?? '';
    },
  });
  const toDataURL = window.HTMLCanvasElement.prototype.toDataURL;
  const getContext = window.HTMLCanvasElement.prototype.getContext;
  window.HTMLCanvasElement.prototype.toDataURL = () => TINY_PNG;
  window.HTMLCanvasElement.prototype.getContext = (() => null) as never;
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = () => 0;
  return () => {
    if (srcDescriptor) Object.defineProperty(image, 'src', srcDescriptor);
    window.HTMLCanvasElement.prototype.toDataURL = toDataURL;
    window.HTMLCanvasElement.prototype.getContext = getContext;
    window.requestAnimationFrame = raf;
  };
}

export const solidProfileHost: ProfileHostKit = {
  open(entries) {
    const restoreGaps = provideBrowserGaps();
    localStorage.clear();
    sessionStorage.clear();
    const [first, ...rest] = entries;
    window.history.replaceState(null, '', first);
    for (const entry of rest) window.history.pushState(null, '', entry);
    return {
      reactivity: solidReactivity,
      platform: asAdapter(createBrowserPlatform()),
      toasts: toastService,
      firstScreen,
      credential,
      liveTemplates: solidLiveTemplates,
      shellHost,
      spaceHost,
      close: restoreGaps,
    };
  },
};
