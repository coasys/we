import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', maplibre: 'src/maplibre/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  splitting: false,
  treeshake: true,
  // Neither engine is bundled: each is the app's own copy, and the MapLibre entry must not reach Cesium.
  external: ['cesium', 'maplibre-gl'],
});
