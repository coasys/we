import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/layers.ts', 'src/layers-maplibre.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  splitting: false,
  treeshake: true,
  // Never bundled: cesium is huge, and @we/widgets must stay a single instance shared with the host.
  external: ['cesium', 'maplibre-gl', '@we/widgets', '@we/schema-shared', 'solid-js'],
});
