import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  // Single solid-js instance across app + libraries.
  resolve: { dedupe: ['solid-js', 'solid-js/web', 'solid-js/store'] },
  // NOTE: no alias needed. @we/schema-solid ships a "solid" export condition (→ its JSX source),
  // which vite-plugin-solid resolves and compiles in this app's Solid toolchain — a single compiler
  // + single runtime, so scheduled reactivity (the $query effect) works. This is exactly what an
  // external consumer does; the pre-built dist is a fallback for non-Solid toolchains and remains
  // suspect for reactivity.
  // PLAN: root-cause + fix why the esbuild-plugin-solid dist breaks scheduled effects downstream.
  server: {
    port: 3200,
    fs: { allow: ['../../../..'] },
  },
  build: { target: 'esnext' },
});
