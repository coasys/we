import { solidPlugin } from 'esbuild-plugin-solid';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  splitting: false,
  treeshake: true,
  // `@we/drag` MUST be external: the session is a module-level singleton, and a bundled copy here
  // would be a *second* session — a card picked up in a feed would be invisible to the composer's
  // drop zone, silently. Same reason `@we/primitives` keeps it external.
  external: ['solid-js', '@we/primitives', '@we/drag'],
  esbuildPlugins: [solidPlugin()],
  esbuildOptions(o) {
    o.jsx = 'automatic';
    o.jsxImportSource = 'solid-js';
  },
});
