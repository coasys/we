/**
 * The app's clocks, by name: one registry for everything that shows a moment.
 *
 * A template reaches it through `clockStore`, a module through the `clocks` kernel, and a globe
 * through the `clocks` prop the host fills in. All three are this registry, so a name means the same
 * clock wherever it is used — which is what lets a globe, a list and a scrubber beside them play
 * together with nothing passing values between them. See `@we/clock`.
 */
import { ClockRegistry } from '@we/clock';

export const clockRegistry = new ClockRegistry();
