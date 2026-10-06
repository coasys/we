/**
 * Which engine a globe draws with, from the module's `engine` setting.
 *
 * Templates never name an engine: they place a globe and its layers, and this decides how they are
 * drawn. Pure, and free of either engine, so the module's definition stays cheap to import.
 */

export type GlobeEngineChoice = 'cesium' | 'maplibre' | 'auto';

/** What a device tells us about itself, for `auto`. Passed in, so the choice can be tested. */
export interface DeviceHints {
  /** `(pointer: coarse)`: a touchscreen is the primary pointer. */
  coarsePointer?: boolean;
  /** `navigator.deviceMemory`, in gigabytes, where the browser says. */
  deviceMemory?: number;
  /** `navigator.hardwareConcurrency`. */
  cores?: number;
}

/** The setting as a choice; anything unrecognised is `auto`. */
export function engineChoiceFrom(settings: Record<string, unknown>): GlobeEngineChoice {
  const value = settings.engine;
  return value === 'cesium' || value === 'maplibre' ? value : 'auto';
}

/**
 * The engine to use. `auto` is Cesium, the full globe, unless the device is a phone or tablet, or a
 * small machine: a touchscreen as its main pointer, 4 GB of memory or less, or 4 cores or fewer. There
 * MapLibre draws the same layers lighter, without the space around the earth or raised lines.
 */
export function resolveEngine(choice: GlobeEngineChoice, device: DeviceHints): 'cesium' | 'maplibre' {
  if (choice !== 'auto') return choice;
  const small =
    device.coarsePointer === true ||
    (device.deviceMemory !== undefined && device.deviceMemory <= 4) ||
    (device.cores !== undefined && device.cores <= 4);
  return small ? 'maplibre' : 'cesium';
}

/** This browser's hints. */
export function deviceHints(): DeviceHints {
  if (typeof window === 'undefined') return {};
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    coarsePointer: window.matchMedia?.('(pointer: coarse)').matches,
    deviceMemory: nav.deviceMemory,
    cores: nav.hardwareConcurrency,
  };
}
