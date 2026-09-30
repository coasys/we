import { SkyBox } from 'cesium';

import type { LayerContext, LayerFactory } from '../../types';

export interface SkyboxLayerOptions {
  /**
   * Which skybox texture set to use
   * - 'tycho2-1k': Tycho-2 star catalog, 1024x1024 (default, fast loading)
   * - 'tycho2-2k': Tycho-2 star catalog, 2048x2048 (high quality)
   * - 'tycho2-4k': Tycho-2 star catalog, 4096x4096 (ultra quality)
   * - 'eso': European Southern Observatory Milky Way
   * - 'custom': Use custom texture paths
   */
  textureSet?: 'tycho2-1k' | 'tycho2-2k' | 'tycho2-4k' | 'eso' | 'custom';

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
   * Where the skybox textures are served from.
   *
   * The default names a **pinned commit**, not a branch. It used to be `@dev`, which jsDelivr resolves
   * afresh: every deployment of WE that has ever shipped was fetching six textures from whatever the
   * tip of a development branch happened to be that morning, with no integrity check and no way to
   * notice a change. A commit landing on `dev` altered what every installed copy of the globe
   * rendered, and anyone able to push to that branch could alter it deliberately.
   *
   * Move it forward on purpose when the textures change, in the same commit that changes them.
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
/**
 * The pinned skybox asset base. See `SkyboxLayerOptions.cdnBaseUrl` for why it is pinned at all.
 *
 * A **commit SHA**, not a tag, because this repository publishes no release tags — an earlier
 * attempt at this pinned `@v0.1.0`, which does not exist, and every globe rendered a 404 instead of
 * a sky. jsDelivr resolves a SHA immutably and a branch afresh on every request, which is the whole
 * distinction being drawn here.
 *
 * **Verify the URL before changing this line.** It is a string that typechecks whatever it says, and
 * nothing in the build or the test suite fetches it:
 *
 *     curl -o /dev/null -w '%{http_code}' \
 *       "https://cdn.jsdelivr.net/gh/coasys/we@<sha>/packages/module-system/globe/layers/src/background/skybox/assets/tycho2-1k/nx.jpg"
 *
 * Move it forward in the same commit that changes the textures, and switch it to a release tag once
 * there is one — a tag is the same immutability and says more to a reader.
 */
export const SKYBOX_CDN_BASE =
  'https://cdn.jsdelivr.net/gh/coasys/we@2e624fafd56762e9c8bbce119f9ac2877124bc0a/packages/module-system/globe/layers/src/background/skybox/assets';

export const skyboxLayer: LayerFactory<SkyboxLayerOptions> = (options?: SkyboxLayerOptions) => ({
  name: 'skybox',

  metadata: {
    requiresIonAccount: false,
    description: 'Display a skybox with star textures in the background.',
  },

  onMount: (context: LayerContext) => {
    const { viewer, onCleanup } = context;
    const { textureSet = 'tycho2-1k', customPaths, cdnBaseUrl = SKYBOX_CDN_BASE } = options || {};
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
    } else if (textureSet === 'tycho2-1k' || textureSet === 'tycho2-2k' || textureSet === 'tycho2-4k') {
      // Tycho-2 skybox textures from CDN at various resolutions
      sources = {
        positiveX: `${cdnBaseUrl}/${textureSet}/px.jpg`,
        negativeX: `${cdnBaseUrl}/${textureSet}/nx.jpg`,
        positiveY: `${cdnBaseUrl}/${textureSet}/py.jpg`,
        negativeY: `${cdnBaseUrl}/${textureSet}/ny.jpg`,
        positiveZ: `${cdnBaseUrl}/${textureSet}/pz.jpg`,
        negativeZ: `${cdnBaseUrl}/${textureSet}/nz.jpg`,
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
      console.warn(`[skybox] Unknown textureSet: ${textureSet}, using tycho2-1k as fallback`);
      sources = {
        positiveX: `${cdnBaseUrl}/tycho2-1k/px.jpg`,
        negativeX: `${cdnBaseUrl}/tycho2-1k/nx.jpg`,
        positiveY: `${cdnBaseUrl}/tycho2-1k/py.jpg`,
        negativeY: `${cdnBaseUrl}/tycho2-1k/ny.jpg`,
        positiveZ: `${cdnBaseUrl}/tycho2-1k/pz.jpg`,
        negativeZ: `${cdnBaseUrl}/tycho2-1k/nz.jpg`,
      };
    }

    // Create the skybox
    const skybox = new SkyBox({ sources });

    // Set the skybox
    viewer.scene.skyBox = skybox;

    // Register cleanup
    onCleanup(() => {
      // Remove the skybox when layer is unmounted
      if (viewer.scene.skyBox === skybox) {
        viewer.scene.skyBox = undefined as unknown as SkyBox;
      }
    });
  },

  onUnmount: () => {
    // Cleanup is handled by onCleanup callbacks
  },
});
