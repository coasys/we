/**
 * Props for the globe widget itself.
 *
 * The **layer protocol** — what a layer implements — lives in `../protocol`, because writing a layer
 * and placing the globe are separate jobs done by different people, increasingly including
 * third-party authors. Re-exported below so existing imports keep working.
 */
export type * from '../protocol';

import type { LayerConfig, LayerFactory } from '../protocol';

/**
 * @ai 3D globe widget using CesiumJS with a modular layer system.
 * Layers are injected via factory functions (planet surface + background).
 * Registered in the app's component registry, which injects `layerFactoryRegistry` — so templates
 * place it as `CesiumGlobe` without supplying that prop themselves.
 */
export interface CesiumGlobeProps {
  /**
   * Cesium Ion access token. Get one free at https://ion.cesium.com/
   * If not provided, uses Cesium's default demo token (limited quota)
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
