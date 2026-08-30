import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  // Single solid-js instance across app + libraries. Load-bearing: two instances give two owner
  // graphs, and scheduled effects (the $query effect) silently stop updating — the initial paint
  // still looks correct, so it fails quietly.
  resolve: { dedupe: ['solid-js', 'solid-js/web', 'solid-js/store'] },
  // No alias needed: @we/schema-solid ships a "solid" export condition (→ its JSX source), which
  // vite-plugin-solid compiles in this app's own toolchain. That's what a Solid-toolchain consumer
  // gets, so it's what this harness should exercise.
  //
  // The pre-built dist works too — verified in-browser 2026-07-20 (initial paint + live reactivity)
  // and guarded headlessly by schema-solid's distReactivity.test.tsx, which runs the feed cases
  // against both entry points. A long-standing TODO here claimed esbuild-plugin-solid's dist broke
  // scheduled effects downstream; it did not reproduce by any route, and the likeliest history is
  // that the real cause was a duplicate solid-js instance, fixed by the dedupe above.
  server: {
    port: 3200,
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
