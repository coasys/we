import { SkyBox } from 'cesium';

import type { LayerContext, LayerFactory } from '../types';

export interface SkyboxLayerOptions {
  /**
   * Which skybox texture set to use
   * - 'tycho2': Tycho-2 star catalog (default)
   * - 'eso': European Southern Observatory Milky Way
   * - 'custom': Use custom texture paths
   */
  textureSet?: 'tycho2' | 'eso' | 'custom';

  /**
   * Custom texture paths (used when textureSet is 'custom')
   * Each face should be a path to an image file
   */
  customPaths?: {
    px: string; // Positive X
    nx: string; // Negative X
    py: string; // Positive Y
    ny: string; // Negative Y
    pz: string; // Positive Z
    nz: string; // Negative Z
  };

  /**
   * Overall brightness multiplier
   * @default 1.0
   */
  brightness?: number;

  /**
   * Whether to show the skybox
   * @default true
   */
  show?: boolean;
}

/**
 * Skybox Layer
 *
 * Displays a skybox with star textures in the background.
 * Supports multiple texture sets and custom textures.
 */
export const skyboxLayer: LayerFactory<SkyboxLayerOptions> = (options?: SkyboxLayerOptions) => ({
  name: 'skybox',

  metadata: {
    requiresIonAccount: false,
    description: 'Display a skybox with star textures in the background.',
  },

  onMount: (context: LayerContext) => {
    const { viewer, onCleanup } = context;
    const { textureSet = 'tycho2', customPaths, show = true } = options || {};
    // TODO: brightness is not yet implemented, needs custom shader
    // const brightness = options?.brightness ?? 1.0;

    // Determine texture paths based on textureSet
    let sources;
    if (textureSet === 'custom' && customPaths) {
      sources = {
        positiveX: customPaths.px,
        negativeX: customPaths.nx,
        positiveY: customPaths.py,
        negativeY: customPaths.ny,
        positiveZ: customPaths.pz,
        negativeZ: customPaths.nz,
      };
    } else if (textureSet === 'tycho2') {
      // Tycho-2 skybox textures
      sources = {
        positiveX: '/skybox/px.jpg',
        negativeX: '/skybox/nx.jpg',
        positiveY: '/skybox/py.jpg',
        negativeY: '/skybox/ny.jpg',
        positiveZ: '/skybox/pz.jpg',
        negativeZ: '/skybox/nz.jpg',
      };
    } else if (textureSet === 'eso') {
      // ESO Milky Way textures (if available)
      sources = {
        positiveX: '/skybox/eso/px.jpg',
        negativeX: '/skybox/eso/nx.jpg',
        positiveY: '/skybox/eso/py.jpg',
        negativeY: '/skybox/eso/ny.jpg',
        positiveZ: '/skybox/eso/pz.jpg',
        negativeZ: '/skybox/eso/nz.jpg',
      };
    } else {
      console.warn(`[skybox] Unknown textureSet: ${textureSet}, using tycho2 as fallback`);
      sources = {
        positiveX: '/skybox/px.jpg',
        negativeX: '/skybox/nx.jpg',
        positiveY: '/skybox/py.jpg',
        negativeY: '/skybox/ny.jpg',
        positiveZ: '/skybox/pz.jpg',
        negativeZ: '/skybox/nz.jpg',
      };
    }

    // Create the skybox
    const skybox = new SkyBox({ sources });
    skybox.show = show;

    // Apply brightness (would need a custom shader for this - placeholder for now)
    // TODO: Implement brightness adjustment with custom shader

    // Set the skybox
    viewer.scene.skyBox = skybox;

    // Register cleanup
    onCleanup(() => {
      if (viewer.scene.skyBox === skybox) {
        viewer.scene.skyBox.show = false;
      }
    });
  },

  onUnmount: () => {
    // Cleanup is handled by onCleanup callbacks
  },
});
