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
    // Resolve the live tokens package at runtime rather than freezing a copy
    // of the scale into the bundle — a token added to @we/tokens must not
    // silently fall through to raw-CSS passthrough until this package rebuilds.
    external: ['@we/tokens'],
  },
  {
    entry: { solid: 'src/solid/index.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    target: 'es2022',
    splitting: false,
    treeshake: true,
    external: ['solid-js', '@we/tokens'],
    esbuildPlugins: [solidPlugin()],
    esbuildOptions(o) {
      o.jsx = 'automatic';
      o.jsxImportSource = 'solid-js';
    },
  },
]);
