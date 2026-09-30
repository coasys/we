import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  // One solid-js instance across app and libraries. Load-bearing: two instances give two owner
  // graphs and effects silently stop updating, which looks correct on first paint.
  resolve: { dedupe: ['solid-js', 'solid-js/web', 'solid-js/store'] },
  /*
    Never pre-bundle the WE packages.

    They resolve to `dist/`, so Vite treats them as ordinary dependencies and caches an optimised copy
    under node_modules/.vite. That copy does not invalidate when the package is rebuilt, so after a
    `pnpm build` the dev server keeps serving the previous design system — silently, and indefinitely.
    It cost a full round of testing here: a fix was verified present in dist and still absent from the
    page, because the page was running a bundle from before it.
  */
  optimizeDeps: {
    exclude: ['@we/primitives', '@we/tokens', '@we/themes', '@we/schema-shared', '@we/design-utils'],
  },
  server: {
    port: 3300,
    fs: { allow: ['../../../..'] },
  },
  build: {
    target: 'esnext',
    /*
      A harness, built as one bundle on purpose: it is loaded from localhost and read end to end,
      so splitting it would only put chunk boundaries between the things it exists to compare.
      Above the flat 500 kB default so the warning means "this grew unexpectedly" rather than
      firing on every build.
    */
    chunkSizeWarningLimit: 1000,
  },
});
