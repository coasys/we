import { createSignal } from 'solid-js';

import weSeedFile from '../../../../we-seed.json';
import type { WeSeedFile } from '../types/seed';

/**
 * App-lifetime flag for routing template queries through the neutral QueryIR. Default from the seed
 * (`features.useQueryIR`); flippable at runtime from the Queries test page (no reload). A module
 * singleton so the renderer (via `$useQueryIR`) and the test-page toggle share one source of truth.
 */
const [enabled, setEnabled] = createSignal((weSeedFile as unknown as WeSeedFile).features?.useQueryIR === true);

export const queryIRFlag = {
  enabled,
  toggle: () => setEnabled((v) => !v),
  set: (v: boolean) => setEnabled(v),
};
