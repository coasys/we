import type { Plugin } from 'vite';

/**
 * Serves the globe layers' own data (country borders) from the app's own origin, at
 * `<base>globe-layers/`. See `vite-plugin.mjs`.
 */
export declare function globeLayerAssets(): Plugin;
