import { solidPlugin } from 'esbuild-plugin-solid';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'solid/index': 'src/frameworks/solid/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  splitting: false,
  treeshake: true,
  external: ['solid-js', '@we/primitives', /\.scss$/, /\.css$/], // Exclude SCSS/CSS imports from bundle
  esbuildPlugins: [solidPlugin()],
  esbuildOptions(o) {
    o.jsx = 'automatic';
    o.jsxImportSource = 'solid-js';
  },
});
