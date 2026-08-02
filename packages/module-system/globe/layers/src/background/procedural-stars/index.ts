import { Cartesian3, Color, PointPrimitive, PointPrimitiveCollection } from 'cesium';

import type { LayerContext, LayerFactory } from '../../types';

export interface ProceduralStarsLayerOptions {
  /**
   * Number of stars to generate
   * @default 5000
   */
  count?: number;

  /**
   * Minimum distance from Earth's surface (in meters)
   * Negative values place stars below the surface
   * @default 43628000 (~43,628 km from surface)
   */
  minDistance?: number;

  /**
   * Maximum distance from Earth's surface (in meters)
   * Negative values place stars below the surface
   * @default 493628000 (~493,628 km from surface)
   */
  maxDistance?: number;

  /**
   * Minimum star brightness (alpha)
   * @default 0.3
   */
  minBrightness?: number;

  /**
   * Maximum star brightness (alpha)
   * @default 1.0
   */
  maxBrightness?: number;

  /**
   * Minimum star size (in pixels)
   * @default 1
   */
  minSize?: number;

  /**
   * Maximum star size (in pixels)
   * @default 3
   */
  maxSize?: number;

  /**
   * Star color
   * @default '#ffffff' (white)
   */
  color?: string;

  /**
   * Whether to show the stars
   * @default true
   */
  show?: boolean;
}

/**
 * Procedural Stars Layer
 *
 * Generates a random field of point stars in space with 3D parallax effect.
 * Stars are distributed at varying distances to create depth.
 */
export const proceduralStarsLayer: LayerFactory<ProceduralStarsLayerOptions> = (
  options?: ProceduralStarsLayerOptions,
) => ({
  name: 'procedural-stars',

  metadata: {
    requiresIonAccount: false,
    description: 'Generate a random field of point stars with 3D parallax effect.',
  },

  onMount: (context: LayerContext) => {
    const { viewer, onCleanup } = context;
    const {
      count = 5000,
      minDistance = 43628000, // Default: ~43,628 km from surface
      maxDistance = 493628000, // Default: ~493,628 km from surface
      minBrightness = 0.3,
      maxBrightness = 1.0,
      minSize = 1,
      maxSize = 3,
      color = '#ffffff',
      show = true,
    } = options || {};

    // Earth's average radius in meters
    const EARTH_RADIUS = 6371000;

    // Convert surface distances to center distances
    const minDistanceFromCenter = EARTH_RADIUS + minDistance;
    const maxDistanceFromCenter = EARTH_RADIUS + maxDistance;

    // Create point primitive collection for stars
    const starCollection = viewer.scene.primitives.add(new PointPrimitiveCollection());
    starCollection.show = show;

    // Parse the color
    const baseColor = Color.fromCssColorString(color);

    // Generate random stars
    for (let i = 0; i < count; i++) {
      // Random spherical coordinates
      const theta = Math.random() * Math.PI * 2; // Azimuth
      const phi = Math.acos(2 * Math.random() - 1); // Polar angle (uniform distribution)
      const distance = minDistanceFromCenter + Math.random() * (maxDistanceFromCenter - minDistanceFromCenter);

      // Convert to Cartesian coordinates
      const x = distance * Math.sin(phi) * Math.cos(theta);
      const y = distance * Math.sin(phi) * Math.sin(theta);
      const z = distance * Math.cos(phi);

      // Random brightness and size
      const brightness = minBrightness + Math.random() * (maxBrightness - minBrightness);
      const size = minSize + Math.random() * (maxSize - minSize);

      // Create star point with varying brightness
      starCollection.add({
        position: new Cartesian3(x, y, z),
        pixelSize: size,
        color: new Color(baseColor.red, baseColor.green, baseColor.blue, brightness),
      } as PointPrimitive);
    }

    // Register cleanup
    onCleanup(() => {
      viewer.scene.primitives.remove(starCollection);
    });
  },

  onUnmount: () => {
    // Cleanup is handled by onCleanup callbacks
  },
});
