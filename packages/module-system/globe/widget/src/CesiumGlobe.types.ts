/**
 * Props for the globe widget itself.
 *
 * The **layer protocol** — what a layer implements — lives in `../protocol`, because writing a layer
 * and placing the globe are separate jobs done by different people, increasingly including
 * third-party authors. Re-exported below so existing imports keep working.
 */
export type * from '@we/globe-protocol';

import type { LayerConfig, LayerFactory } from '@we/globe-protocol';

/**
 * @ai 3D globe widget using CesiumJS with a modular layer system.
 * Layers are injected via factory functions (planet surface + background).
 * Registered in the app's component registry, which injects `layerFactoryRegistry` — so templates
 * place it as `CesiumGlobe` without supplying that prop themselves.
 */
export interface CesiumGlobeProps {
  /**
   * A Cesium ion access token, which swaps the default imagery (Natural Earth II under NASA GIBS
   * Blue Marble) for ion's world imagery and admits layers that declare `requiresIonAccount`.
   * Injected by the host from the globe module's `ionAccessToken` setting, never written in a
   * template: a token in a schema is a credential handed to everyone who reads it.
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
