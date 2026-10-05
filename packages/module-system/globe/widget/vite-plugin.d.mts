import type { Plugin } from 'vite';

/**
 * Serves Cesium's runtime files (workers, wasm, widget CSS, textures) from the app's own origin, at
 * `<base>cesium/`. See `vite-plugin.mjs`.
 */
export declare function cesiumAssets(): Plugin;
