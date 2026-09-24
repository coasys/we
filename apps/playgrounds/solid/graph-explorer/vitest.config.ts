import solidPlugin from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [solidPlugin()],
  resolve: { dedupe: ['solid-js', 'solid-js/web', 'solid-js/store'] },
  test: {
    environment: 'happy-dom',
    // The renderer's source, not its dist — the harness is here to exercise what a Solid-toolchain
    // consumer actually compiles.
    server: { deps: { inline: [/@we\//] } },
  },
});
