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
  // design-utils is externalized so the published bundle resolves the live
  // package instead of freezing a copy of it at build time.
  external: ['solid-js', '@we/primitives', '@we/design-utils', /\.scss$/, /\.css$/],
  esbuildPlugins: [solidPlugin()],
  esbuildOptions(o) {
    o.jsx = 'automatic';
    o.jsxImportSource = 'solid-js';
  },
});
