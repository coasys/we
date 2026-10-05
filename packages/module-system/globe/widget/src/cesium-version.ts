/**
 * `cesium` exports its own version at runtime (`export const VERSION = '1.144.0'` in
 * `Source/Cesium.js`) and leaves it out of `Cesium.d.ts`. Declared here so the asset URL can be
 * built from the installed package instead of a version typed out by hand, which is how the CDN
 * came to serve 1.136's workers to 1.144's engine.
 *
 * A module rather than a `.d.ts` so it travels with the widget's source: a package compiling that
 * source (the app shell) includes what it imports and nothing else in this folder.
 */
export {};

declare module 'cesium' {
  export const VERSION: string;
}
