import solidPlugin from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [solidPlugin()],
  resolve: {
    dedupe: ['solid-js', 'solid-js/web', 'solid-js/store'],
    // No alias: @we/schema-solid ships a "solid" export condition (→ source), which vite-plugin-solid
    // resolves and compiles with this app's Solid toolchain. See the note in vite.config.
  },
  test: {
    environment: 'happy-dom',
  },
});
