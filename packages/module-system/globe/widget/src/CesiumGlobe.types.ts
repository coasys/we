/**
 * Props for the globe widget itself.
 *
 * The **layer protocol** — what a layer implements — lives in `../protocol`, because writing a layer
 * and placing the globe are separate jobs done by different people, increasingly including
 * third-party authors. Re-exported below so existing imports keep working.
 */
export type * from '@we/globe-protocol';

import type { ClockRegistry, ClockSettings } from '@we/clock';
import type { LayerConfig, LayerKinds } from '@we/globe-protocol';

/**
 * A clock for a globe to follow, written out. `id` names one of the app's clocks, shared with
 * `clockStore` and anything else of that name; without one, the globe keeps a clock of its own.
 * The rest are the clock's settings, applied when the prop changes — so the template's are a
 * starting point a scrubber can then change.
 */
export interface GlobeClockOptions extends ClockSettings {
  id?: string;
  /** Start playing as soon as the globe has its data. */
  autoplay?: boolean;
}

/** A commercial imagery provider and the key to reach it. See `imagery.ts`. */
export interface ImageryChoice {
  provider: 'ion' | 'esri' | 'mapbox';
  key: string;
}

/**
 * @ai 3D globe widget using CesiumJS with a modular layer system.
 * Layers are named by kind in two lists (planet surface + background).
 * Registered in the app's component registry, which injects `layerKinds`, so templates place it as
 * `CesiumGlobe` without supplying that prop themselves.
 */
export interface CesiumGlobeProps {
  /**
   * The commercial imagery to draw instead of NASA's, with its key. Absent draws NASA's. Injected by
   * the host from the globe module's `imagery` setting and the key setting for that provider, never
   * written in a template: a key in a schema is a credential handed to everyone who reads it.
   */
  imagery?: ImageryChoice;
  /**
   * A Cesium ion access token, whichever imagery is drawn. Admits layers that declare
   * `requiresIonAccount`. Injected by the host from the globe module's `ionAccessToken` setting.
   */
  ionAccessToken?: string;
  /** Planet surface layer configurations (locations, outlines, hexagons, etc.) */
  planetLayers?: LayerConfig[];
  /** Background/space layer configurations (skybox, stars, etc.) */
  backgroundLayers?: LayerConfig[];
  /** The kinds `factory` resolves against, by id. Injected by the host. */
  layerKinds: LayerKinds;
  /**
   * The clock the layers follow: a name (`"events"`), or {@link GlobeClockOptions}. A data layer with
   * a `time` field then draws only the rows up to the clock's moment. Absent: no clock, every row.
   */
  clock?: string | GlobeClockOptions;
  /** The app's clocks, which a name resolves against. Injected by the host. */
  clocks?: ClockRegistry;
}
