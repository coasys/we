/**
 * The app's clocks, by name: one registry for everything that shows a moment.
 *
 * A template reaches it through `clockStore`, a module through the `clocks` kernel, and a globe
 * through the `clocks` prop the host fills in. All three are this registry, so a name means the same
 * clock wherever it is used — which is what lets a globe, a list and a scrubber beside them play
 * together with nothing passing values between them. See `@we/clock`.
 *
 * Made where the stores are composed (`composeStores`), on the platform's frames, so a clock playing
 * moves on whatever the host paints with — a browser's animation frames, or a test's, which advance
 * only when the test runs them. The composition lends it here for the two readers that are not
 * stores: the module host services and the globe.
 */
import { ClockRegistry } from '@we/clock';

import { hostSlot } from './hostSlot';
import type { PlatformPort } from './platform/port';

/** The app's clock registry, playing on the platform's frames and the runtime's clock. */
export function createAppClocks(platform: Pick<PlatformPort, 'frame'>): ClockRegistry {
  return new ClockRegistry({ now: () => performance.now(), frame: (callback) => platform.frame(callback) });
}

const lent = hostSlot<ClockRegistry>();

/** Lend the composed registry to the readers that are not stores. Returns the disposer. */
export const provideAppClocks = lent.provide;

/** The app's clocks, as composed — throws, saying so, before the stores have been. */
export const appClocks = (): ClockRegistry => lent.need('The app’s clocks (provideAppClocks)');
