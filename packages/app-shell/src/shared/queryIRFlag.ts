import { createSignal } from 'solid-js';

import { getSeed } from './seedRegistry';

/**
 * App-lifetime flag for routing template queries through the neutral QueryIR. Default from the seed
 * (`features.useQueryIR`); flippable at runtime from the Queries test page (no reload). A module
 * singleton so the renderer (via `$useQueryIR`) and the test-page toggle share one source of truth.
 *
 * The seed default is applied on first read rather than at module load, because this module is
 * imported before the host has supplied the seed — import order is not initialisation order.
 */
const [enabled, setEnabled] = createSignal<boolean | null>(null);

export const queryIRFlag = {
  enabled: () => enabled() ?? getSeed().features?.useQueryIR === true,
  toggle: () => setEnabled(!(enabled() ?? getSeed().features?.useQueryIR === true)),
  set: (v: boolean) => setEnabled(v),
};
