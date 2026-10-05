/**
 * `WE_GLOBE_LAYER_ASSETS_URL` is defined by `globeLayerAssets()` in `../vite-plugin.mjs`: where the
 * app serves this package's `assets/`. Absent in a host without the plugin.
 *
 * Read only inside a layer's `onMount`, never at module scope: this package is compiled by tsup and
 * the name stays as written until the app's Vite build replaces it, and outside Vite there is no
 * `import.meta.env` to read it from.
 */
export {};

declare global {
  interface ImportMetaEnv {
    readonly WE_GLOBE_LAYER_ASSETS_URL?: string;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}
