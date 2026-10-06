/**
 * Two names the widget reads that nothing else declares.
 *
 * `VERSION`: `cesium` exports its own version at runtime (`export const VERSION = '1.144.0'` in
 * `Source/Cesium.js`) and leaves it out of `Cesium.d.ts`. Declared so the CDN fallback is built
 * from the installed package instead of a version typed out by hand, which is how the CDN came to
 * serve 1.136's workers to 1.144's engine.
 *
 * `WE_CESIUM_BASE_URL`: defined by `cesiumAssets()` in `../vite-plugin.mjs`, where the app serves
 * Cesium's runtime files. Absent in a host without the plugin.
 *
 * A module rather than a `.d.ts` so it travels with the widget's source: a package compiling that
 * source (the app shell) includes what it imports and nothing else in this folder.
 */
export {};

declare module 'cesium' {
  export const VERSION: string;
}

declare global {
  interface ImportMetaEnv {
    readonly WE_CESIUM_BASE_URL?: string;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}
