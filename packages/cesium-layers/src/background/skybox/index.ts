import { SkyBox } from 'cesium';

import type { LayerContext, LayerFactory } from '../../types';

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
   * Base URL for CDN assets
   * @default 'https://cdn.jsdelivr.net/gh/jhweir/we@we-native-app/packages/cesium-layers/src/background/skybox/assets'
   */
  cdnBaseUrl?: string;

  /**
   * Overall brightness multiplier
   * @default 1.0
   */
  brightness?: number;
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
    const {
      textureSet = 'tycho2',
      customPaths,
      // Use jsdelivr CDN with branch name
      cdnBaseUrl = 'https://cdn.jsdelivr.net/gh/jhweir/we@we-native-app/packages/cesium-layers/src/background/skybox/assets',
    } = options || {};
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
      // Tycho-2 skybox textures from CDN
      sources = {
        positiveX: `${cdnBaseUrl}/tycho2/px.jpg`,
        negativeX: `${cdnBaseUrl}/tycho2/nx.jpg`,
        positiveY: `${cdnBaseUrl}/tycho2/py.jpg`,
        negativeY: `${cdnBaseUrl}/tycho2/ny.jpg`,
        positiveZ: `${cdnBaseUrl}/tycho2/pz.jpg`,
        negativeZ: `${cdnBaseUrl}/tycho2/nz.jpg`,
      };
    } else if (textureSet === 'eso') {
      // ESO Milky Way textures (if available)
      sources = {
        positiveX: `${cdnBaseUrl}/eso/px.jpg`,
        negativeX: `${cdnBaseUrl}/eso/nx.jpg`,
        positiveY: `${cdnBaseUrl}/eso/py.jpg`,
        negativeY: `${cdnBaseUrl}/eso/ny.jpg`,
        positiveZ: `${cdnBaseUrl}/eso/pz.jpg`,
        negativeZ: `${cdnBaseUrl}/eso/nz.jpg`,
      };
    } else {
      console.warn(`[skybox] Unknown textureSet: ${textureSet}, using tycho2 as fallback`);
      sources = {
        positiveX: `${cdnBaseUrl}/tycho2/px.jpg`,
        negativeX: `${cdnBaseUrl}/tycho2/nx.jpg`,
        positiveY: `${cdnBaseUrl}/tycho2/py.jpg`,
        negativeY: `${cdnBaseUrl}/tycho2/ny.jpg`,
        positiveZ: `${cdnBaseUrl}/tycho2/pz.jpg`,
        negativeZ: `${cdnBaseUrl}/tycho2/nz.jpg`,
      };
    }

    // Create the skybox
    const skybox = new SkyBox({ sources });

    // Set the skybox
    viewer.scene.skyBox = skybox;

    // Register cleanup
    onCleanup(() => {
      // Hide the skybox when layer is unmounted
      if (viewer.scene.skyBox === skybox) {
        viewer.scene.skyBox.show = false;
      }
    });
  },

  onUnmount: () => {
    // Cleanup is handled by onCleanup callbacks
  },
});
