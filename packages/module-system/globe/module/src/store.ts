/**
 * The globe module's store: which engine is drawing, for a template to read.
 *
 * Templates never choose an engine, but a template may need to know which one is drawing — so a menu
 * of layers does not offer stars and planets a MapLibre globe will never draw. Read as
 * `modules.globe.engine` and `modules.globe.drawsSpace`.
 */
import type { ModuleStore, ModuleStoreDeps } from '@we/module-shared';

import { deviceHints, engineChoiceFrom, resolveEngine } from './engine';

export function createGlobeStore(deps: ModuleStoreDeps): ModuleStore {
  const { state } = deps;
  // The device does not change while the app runs; the setting can.
  const device = deviceHints();
  const engine = () => resolveEngine(engineChoiceFrom(deps.settings?.() ?? {}), device);
  return {
    engine: state(
      engine,
      'Which engine draws the globe here — "cesium" or "maplibre" — from the setting and this device.',
    ),
    drawsSpace: state(
      () => engine() === 'cesium',
      'Whether the globe draws the space around the earth — the skybox, stars and solar system. False on MapLibre.',
    ),
  };
}
