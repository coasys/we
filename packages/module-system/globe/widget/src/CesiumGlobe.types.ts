/**
 * Props for the globe widget itself.
 *
 * The **layer protocol** — what a layer implements — lives in `../protocol`, because writing a layer
 * and placing the globe are separate jobs done by different people, increasingly including
 * third-party authors. Re-exported below so existing imports keep working.
 */
export type * from '@we/globe-protocol';

import type { LayerConfig, LayerFactory } from '@we/globe-protocol';

/** A commercial imagery provider and the key to reach it. See `imagery.ts`. */
export interface ImageryChoice {
  provider: 'ion' | 'esri' | 'mapbox';
  key: string;
}

/**
 * @ai 3D globe widget using CesiumJS with a modular layer system.
 * Layers are injected via factory functions (planet surface + background).
 * Registered in the app's component registry, which injects `layerFactoryRegistry` — so templates
 * place it as `CesiumGlobe` without supplying that prop themselves.
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
  /** Layer factory registry - injected from app */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  layerFactoryRegistry: Record<string, LayerFactory<any>>;
}
