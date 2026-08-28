import solidPlugin from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [solidPlugin()],
  resolve: {
    dedupe: ['solid-js', 'solid-js/web', 'solid-js/store'],
    conditions: ['development', 'browser'],
  },
  test: {
    environment: 'happy-dom',
  },
});
