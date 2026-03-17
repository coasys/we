import { solidPlugin } from 'esbuild-plugin-solid';
import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2022',
    splitting: false,
    treeshake: true,
  },
  {
    entry: { solid: 'src/solid/index.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    target: 'es2022',
    splitting: false,
    treeshake: true,
    external: ['solid-js'],
    esbuildPlugins: [solidPlugin()],
    esbuildOptions(o) {
      o.jsx = 'automatic';
      o.jsxImportSource = 'solid-js';
    },
  },
]);
