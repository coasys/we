import path from 'path';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  assetsInclude: ['**/*.glb'],
  plugins: [solidPlugin()],
  server: {
    port: 3000,
    fs: {
      // Allow serving files from workspace root (for seed files from sibling projects)
      allow: ['../..'],
    },
  },
  build: {
    target: 'esnext',
    /*
      Above the flat 500 kB default, deliberately.

      Four chunks crossed it, and three are third-party viewer libraries already behind a dynamic
      import: Cesium (~3.17 MB, as `src-*` and `SkyBox-*`) and three.js (~605 kB, as `WeCube-*`),
      each fetched the first time a template draws a globe or the cube. Rollup's limit is per-chunk
      and cannot tell a deferred chunk from the entry, so it reported all four on every build — and
      the fix it recommends, `import()`, was already taken for three of them.

      Set just above Cesium, so this still fires if a vendor chunk grows by a third.

      The cost is the fourth: the eager entry chunk (~2.48 MB, 674 kB gzipped, mostly
      `@coasys/ad4m`) is now under the limit as well. Nothing was guarding that number before —
      the warning had fired on every build for long enough to be read as noise — but if it should
      be, it wants a budget measured over the entry's static import graph, not a per-chunk ceiling.
    */
    chunkSizeWarningLimit: 3500,
  },
  // Never pre-bundle local file: deps — hard links break on rebuild, causing
  // Vite's dep optimizer cache to serve stale content after restart.
  optimizeDeps: { exclude: ['@coasys/ad4m', '@coasys/ad4m-connect'] },
  resolve: {
    alias: {
      // Resolve @we/app-shell internal aliases
      '@shared': path.resolve(import.meta.dirname, '../../packages/app-shell/src/shared'),
      '@solid': path.resolve(import.meta.dirname, '../../packages/app-shell/src/frameworks/solid'),
    },
  },
});
